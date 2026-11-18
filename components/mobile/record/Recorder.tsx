"use client";
/**
 * In-browser recorder (plan §6).
 *
 * - Pause = stop the MediaRecorder; the piece starts uploading right away.
 *   Resume = a new MediaRecorder on the same stream. The tech never sees "segment".
 * - Retake while recording throws the current piece away; while paused it
 *   removes the last piece (in-page confirm).
 * - Total length is capped at maxMs; at the cap recording pauses itself.
 * - Hiding the page while recording pauses it, so the piece is saved.
 * - Camera watchdog: if iOS takes the camera away mid-take (the video track
 *   mutes, or the preview gets no new frame for FRAME_STALL_MS) while the mic
 *   keeps going, the take is stopped, the camera is reopened and the tech is
 *   told to Resume. Without this the piece would freeze on its last frame.
 * - Recorder watchdog: Safari's MediaRecorder can stop writing video while the
 *   camera and sound carry on. Data is collected every RECORDER_TIMESLICE_MS; if
 *   it drops to sound-only levels (`recorderStalled`) the take is ended and a new
 *   one starts on the same camera by itself. Repeated stalls fall back to the
 *   camera-lost path (pause + reopen the camera).
 * - The server checks each uploaded piece too (`video_cut_at_ms`); a flagged
 *   part is marked in the strip and Finish asks before going ahead.
 * - Exit with parts recorded keeps the inspection as a draft (home list, tap to resume);
 *   with nothing recorded it deletes the inspection so it never shows up.
 * - Finish waits for uploads, calls /finish, then opens the inspection.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Play, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  formatDuration,
  MIN_PIECE_MS,
  pickMimeType,
  RECORDER_TIMESLICE_MS,
  recorderStalled,
  STALL_WINDOW_MS,
  VIDEO_BITS_PER_SECOND,
  type ChunkMark,
} from "@/lib/recording";
import { UploadQueue, type Piece } from "@/lib/recorder/uploadQueue";
import type { SegmentStatus } from "@/lib/types/db";
import { TipsOverlay, tipsHidden } from "./TipsOverlay";
import { createSegmentTransport } from "./transport";

const noopSubscribe = () => () => {};

export interface InitialSegment {
  n: number;
  status: SegmentStatus;
  url: string;
  mimeType: string;
  videoCutAtMs: number | null;
}

/** No new camera frame for this long while recording = the camera was taken away. */
const FRAME_STALL_MS = 1500;

/** More automatic restarts than this within ROLLOVER_WINDOW_MS = give up and pause. */
const MAX_ROLLOVERS = 2;
const ROLLOVER_WINDOW_MS = 30_000;

type Phase = "starting" | "idle" | "recording" | "finishing" | "error";

interface Session {
  rec: MediaRecorder;
  startedAt: number;
  stoppedAt: number | null;
  discard: boolean;
  /** The camera died mid-take: reopen it once the recorder has flushed. */
  restartCamera: boolean;
  /** The recorder stalled: start a new take on the same camera once this one is saved. */
  rollover: boolean;
  /** Recent data deliveries, for the stall check. */
  marks: ChunkMark[];
}

type Facing = "environment" | "user";

type Shape = "tall" | "wide" | "any";

function camera(facing: Facing, shape: Shape): MediaStreamConstraints {
  const size =
    shape === "any"
      ? {}
      : { width: { ideal: shape === "tall" ? 720 : 1280 }, height: { ideal: shape === "tall" ? 1280 : 720 } };
  return { video: { facingMode: { ideal: facing }, ...size, frameRate: { ideal: 30 } }, audio: true };
}

/** Displayed size of a stream (rotation applied), via a throwaway <video>. null if it can't tell. */
function streamSize(stream: MediaStream): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    const done = (r: { w: number; h: number } | null) => {
      clearTimeout(timer);
      v.srcObject = null;
      resolve(r);
    };
    const timer = setTimeout(() => done(null), 3000);
    v.onloadedmetadata = () => done(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
    v.srcObject = stream;
    v.play().catch(() => {});
  });
}

/**
 * Open the camera in the phone's orientation: tall when upright, wide when on
 * its side. iOS Safari doesn't always honor the size it's asked for (an upright
 * iPhone has handed back a wide picture), so check what came back and, if it's
 * the wrong shape, ask with the sizes swapped, then with no size at all. If
 * nothing matches, open it the normal way rather than fail.
 */
async function openCamera(facing: Facing): Promise<MediaStream> {
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const want: Shape = portrait ? "tall" : "wide";
  for (const shape of [want, portrait ? "wide" : "tall", "any"] as const) {
    const stream = await navigator.mediaDevices.getUserMedia(camera(facing, shape));
    const size = await streamSize(stream);
    if (!size || size.h > size.w === portrait) return stream;
    // Wrong shape. iOS allows one camera stream at a time, so close it before asking again.
    stream.getTracks().forEach((t) => t.stop());
  }
  return navigator.mediaDevices.getUserMedia(camera(facing, want));
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera or microphone access is blocked. Allow both in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera or microphone was found on this device.";
  if (name === "NotReadableError") return "The camera is in use by another app. Close it, then try again.";
  return "The camera couldn't start. Try again.";
}

/** Length of an uploaded piece from its metadata; null if the browser can't tell. */
function probeDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const done = (ms: number | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(ms);
    };
    const timer = setTimeout(() => done(null), 10_000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

export function Recorder({
  inspectionId,
  maxMs,
  initialSegments,
}: {
  inspectionId: string;
  maxMs: number;
  initialSegments: InitialSegment[];
}) {
  const router = useRouter();
  // Earlier visit (e.g. iOS reloaded the tab): keep uploaded pieces; pieces from
  // the first not-uploaded one onward can't be re-sent, so they are deleted.
  const [boot] = useState(() => {
    const sorted = [...initialSegments].sort((a, b) => a.n - b.n);
    const firstBad = sorted.find((s) => s.status !== "uploaded")?.n ?? Infinity;
    const keep = sorted.filter((s) => s.n < firstBad);
    const drop = sorted.filter((s) => s.n >= firstBad).map((s) => s.n);
    const notice =
      drop.length === 0
        ? null
        : drop.length === 1
          ? "One part from before didn't finish uploading and was removed."
          : `${drop.length} parts from before didn't finish uploading and were removed.`;
    return { keep, drop, notice };
  });
  const [queue] = useState(() => {
    const q = new UploadQueue(createSegmentTransport(inspectionId));
    q.seed(boot.keep.map((s) => ({ n: s.n, durationMs: null, mimeType: s.mimeType, videoCutAtMs: s.videoCutAtMs })));
    return q;
  });
  const pieces = useSyncExternalStore(queue.subscribe, queue.getPieces, queue.getPieces);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>("");
  const sessionRef = useRef<Session | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const seededRef = useRef(false);
  const facingRef = useRef<Facing>("environment");
  const lastFrameAtRef = useRef<number | null>(null); // null = can't watch frames (no rVFC)
  const cameraLostRef = useRef<() => void>(() => {});
  const startCameraRef = useRef<() => Promise<void>>(async () => {});
  const startPieceRef = useRef<() => Promise<void>>(async () => {});
  const rolloversRef = useRef<number[]>([]); // when each automatic restart happened

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const tipsPrefHidden = useSyncExternalStore(noopSubscribe, tipsHidden, () => true);
  const [tipsOpen, setTipsOpen] = useState<boolean | null>(null); // null = default
  const showTips = tipsOpen ?? (!tipsPrefHidden && boot.keep.length === 0);
  const setShowTips = setTipsOpen;
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [confirmCut, setConfirmCut] = useState<string | null>(null); // server's "video freezes" message
  const [stopping, setStopping] = useState(false); // waiting for MediaRecorder's onstop
  const [capHit, setCapHit] = useState(false); // set when the timer stops at the cap
  const [notice, setNotice] = useState<string | null>(boot.notice);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [canFlip, setCanFlip] = useState(false); // more than one camera on this device
  const [previewN, setPreviewN] = useState<number | null>(null); // part open in the player
  const [now, setNow] = useState(0);
  const [pieceStartedAt, setPieceStartedAt] = useState<number | null>(null);

  const keptMs = pieces.reduce((sum, p) => sum + (p.durationMs ?? 0), 0);
  const unknownLengths = pieces.some((p) => p.durationMs === null);
  const currentMs = phase === "recording" && pieceStartedAt !== null ? Math.max(0, now - pieceStartedAt) : 0;
  const totalMs = keptMs + currentMs;
  const capReached = capHit || keptMs >= maxMs;

  // ── Earlier visit: continue after the uploaded pieces ──────────────────────
  useEffect(() => {
    if (seededRef.current) return; // StrictMode runs effects twice in dev
    seededRef.current = true;
    if (boot.drop.length) queue.seedDeletes(boot.drop);
    for (const s of boot.keep) void probeDuration(s.url).then((ms) => queue.setDuration(s.n, ms));
  }, [boot, queue]);

  // ── Camera ────────────────────────────────────────────────────────────────
  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const stopPiece = useCallback(
    (discard: boolean) => {
      const s = sessionRef.current;
      if (!s) return;
      s.discard = discard;
      s.stoppedAt = performance.now();
      sessionRef.current = null;
      setPieceStartedAt(null);
      setStopping(true);
      try {
        s.rec.stop();
      } catch {
        setStopping(false);
      }
      releaseWakeLock();
      setPhase("idle");
    },
    [releaseWakeLock],
  );

  const startCamera = useCallback(async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("The camera needs a secure connection. Open this page through the https tunnel URL, not an http address.");
      setPhase("error");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("This browser can't record video. Try Safari on iPhone or Chrome on Android.");
      setPhase("error");
      return;
    }
    const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) {
      setError("This browser can't record video in a supported format.");
      setPhase("error");
      return;
    }
    mimeRef.current = mime;
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await openCamera(facingRef.current);
      streamRef.current = stream;
      for (const track of stream.getTracks()) {
        track.onended = () => {
          if (sessionRef.current) stopPiece(false);
          setError("The camera stopped. Start it again to keep recording.");
          setPhase("error");
        };
        // iOS mutes the camera (rather than ending it) when something else takes it.
        if (track.kind === "video") track.onmute = () => cameraLostRef.current();
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setError(null);
      setPhase("idle");
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setCanFlip(d.filter((x) => x.kind === "videoinput").length > 1))
        .catch(() => {});
    } catch (err) {
      setError(cameraErrorMessage(err));
      setPhase("error");
    }
  }, [stopPiece]);

  useEffect(() => {
    // Syncing with an external system (the camera). Only the unsupported-browser
    // paths set state synchronously, once, at mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void startCamera();
    return () => {
      const s = sessionRef.current;
      if (s) {
        s.discard = true;
        try {
          s.rec.stop();
        } catch {}
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      wakeLockRef.current?.release().catch(() => {});
    };
  }, [startCamera]);

  useEffect(() => () => queue.dispose(), [queue]);

  useEffect(() => {
    startCameraRef.current = startCamera;
  }, [startCamera]);

  /** The camera stopped mid-take: keep what was recorded, reopen the camera, tell the tech. */
  const cameraLost = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    s.restartCamera = true;
    stopPiece(false);
    setNotice("The camera stopped, so recording paused. Everything up to that point is saved. Tap Resume to keep going.");
    try {
      navigator.vibrate?.(300);
    } catch {}
  }, [stopPiece]);

  useEffect(() => {
    cameraLostRef.current = cameraLost;
  }, [cameraLost]);

  // Rotating the phone before anything is recorded re-opens the camera in the new
  // orientation. Once a piece exists the orientation is locked, so every part matches.
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = () => {
      if (sessionRef.current || queue.getPieces().length > 0) return;
      void startCamera();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [queue, startCamera]);

  const startPiece = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream || sessionRef.current || capReached) return;
    setNotice(null);
    setFinishError(null);
    setPreviewN(null); // leave the part player so the live camera is what's on screen
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mimeRef.current, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    } catch {
      setError("Recording couldn't start. Reload the page and try again.");
      setPhase("error");
      return;
    }
    const s: Session = {
      rec,
      startedAt: performance.now(),
      stoppedAt: null,
      discard: false,
      restartCamera: false,
      rollover: false,
      marks: [],
    };
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      chunks.push(e.data);
      const t = performance.now();
      s.marks.push({ t, bytes: e.data.size });
      while (s.marks.length && s.marks[0].t < t - 2 * STALL_WINDOW_MS) s.marks.shift();
    };
    rec.onstop = () => {
      setStopping(false);
      if (s.restartCamera) {
        setPhase("starting");
        void startCameraRef.current();
      }
      if (!s.discard) {
        const durationMs = Math.round((s.stoppedAt ?? performance.now()) - s.startedAt);
        const type = rec.mimeType || mimeRef.current;
        const blob = new Blob(chunks, { type });
        if (blob.size > 0 && durationMs >= MIN_PIECE_MS) queue.add(blob, type, durationMs);
      }
      if (s.rollover) {
        void startPieceRef.current();
        setNotice("The phone's recorder hiccuped, so recording carried on in a new part. Nothing was lost.");
      }
    };
    rec.onerror = () => {
      stopPiece(false);
      setNotice("Recording stopped unexpectedly. What was recorded so far is saved.");
    };
    sessionRef.current = s;
    rec.start(RECORDER_TIMESLICE_MS);
    setPieceStartedAt(s.startedAt);
    setNow(s.startedAt);
    setPhase("recording");
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {}
  }, [capReached, queue, stopPiece]);

  useEffect(() => {
    startPieceRef.current = startPiece;
  }, [startPiece]);

  /** The recorder stopped writing video but the camera is fine: save this take and start another. */
  const rollOver = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const t = performance.now();
    const recent = rolloversRef.current.filter((x) => x > t - ROLLOVER_WINDOW_MS);
    if (recent.length >= MAX_ROLLOVERS) {
      // Keeps happening: reopen the camera and let the tech decide.
      rolloversRef.current = [];
      cameraLost();
      return;
    }
    rolloversRef.current = [...recent, t];
    s.rollover = true;
    stopPiece(false);
  }, [cameraLost, stopPiece]);

  // ── Camera watchdog: count preview frames while recording ──────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (phase !== "recording" || !v || typeof v.requestVideoFrameCallback !== "function") {
      lastFrameAtRef.current = null;
      return;
    }
    lastFrameAtRef.current = performance.now();
    let handle = 0;
    const onFrame = () => {
      lastFrameAtRef.current = performance.now();
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    return () => v.cancelVideoFrameCallback(handle);
  }, [phase]);

  // ── Timer + cap + frame stall ─────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      const t = performance.now();
      setNow(t);
      const lastFrame = lastFrameAtRef.current;
      if (lastFrame !== null && t - lastFrame > FRAME_STALL_MS) {
        cameraLost();
        return;
      }
      if (recorderStalled(s.marks, t, s.startedAt)) {
        rollOver();
        return;
      }
      const kept = queue.getPieces().reduce((sum, p) => sum + (p.durationMs ?? 0), 0);
      if (kept + (t - s.startedAt) >= maxMs) {
        stopPiece(false);
        setCapHit(true);
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, maxMs, queue, stopPiece, cameraLost, rollOver]);


  // ── Page hidden while recording = Pause ───────────────────────────────────
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && sessionRef.current) {
        stopPiece(false);
        setNotice("Recording paused because the app was in the background. Tap Resume to keep going.");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stopPiece]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const retakeLast = () => {
    setConfirmRetake(false);
    if (queue.retakeLast() !== null) setCapHit(false);
  };

  const finish = async (allowVideoCut = false) => {
    setFinishError(null);
    setConfirmCut(null);
    setPhase("finishing");
    const ok = await queue.waitIdle();
    if (!ok) {
      setFinishError(queue.failureMessage ?? "Some parts didn't upload.");
      setPhase("idle");
      return;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/finish`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allow_video_cut: allowVideoCut }),
        });
        if (res.ok) break;
        const body = await res.json().catch(() => null);
        if (body?.code === "video_cut") {
          setConfirmCut(body.error ?? "A part's video freezes. Finish anyway?");
          setPhase("idle");
          return;
        }
        if (res.status < 500 || attempt >= 2) {
          setFinishError(body?.error ?? `Couldn't finish (${res.status}).`);
          setPhase("idle");
          return;
        }
      } catch {
        if (attempt >= 2) {
          setFinishError("No connection. Check your network and tap Finish again.");
          setPhase("idle");
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    router.replace(`/inspections/${inspectionId}`);
  };

  /** Where to play a part from: this visit's recording, else the copy on the server. */
  const sourceFor = (p: Piece): string | null =>
    p.blob ? blobUrl(p.blob) : (boot.keep.find((k) => k.n === p.n)?.url ?? null);
  const previewPiece = previewN === null ? null : (pieces.find((p) => p.n === previewN) ?? null);
  const previewSrc = previewPiece ? sourceFor(previewPiece) : null;

  /** Switch between the back and front camera. Only between takes: a take is one camera. */
  const flipCamera = () => {
    const next: Facing = facingRef.current === "environment" ? "user" : "environment";
    facingRef.current = next;
    setFacing(next);
    setPhase("starting");
    void startCamera();
  };

  const exit = async () => {
    if (queue.getPieces().length === 0) {
      // Nothing recorded: drop the empty inspection. If this fails the list hides it anyway.
      await fetch(`/api/inspections/${inspectionId}`, { method: "DELETE" }).catch(() => {});
    }
    router.push("/");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const recording = phase === "recording";
  const hasPieces = pieces.length > 0;
  const failure = queue.failureMessage;
  const cutPiece = pieces.find((p) => p.videoCutAtMs !== null) ?? null;
  const canExit = !recording && phase !== "finishing" && queue.settled && !stopping;

  return (
    <div className="theme-dark fixed inset-0 flex flex-col">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
        <div className="w-20">
          {canExit ? (
            <button type="button" onClick={() => void exit()} className="text-sm text-muted-foreground hover:text-foreground">
              ← Exit
            </button>
          ) : null}
        </div>
        <div className="flex flex-1 items-center justify-center gap-2 font-mono text-sm tabular-nums" aria-live="off">
          {recording ? <span aria-hidden className="size-2 rounded-full bg-red-fg" /> : null}
          <span>{formatDuration(totalMs)}</span>
          <span className="text-muted-foreground">/ {formatDuration(maxMs)}</span>
        </div>
        <div className="flex w-20 justify-end">
          {!recording && phase !== "finishing" ? (
            <button type="button" onClick={() => setShowTips(true)} className="text-sm text-muted-foreground hover:text-foreground">
              Tips
            </button>
          ) : null}
        </div>
      </div>

      {/* Camera */}
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={cn("absolute inset-0 h-full w-full", facing === "user" && "-scale-x-100")}
        />
        {canFlip && phase === "idle" && !stopping ? (
          <button
            type="button"
            onClick={flipCamera}
            aria-label={facing === "user" ? "Switch to the back camera" : "Switch to the front camera"}
            className="absolute top-3 right-3 z-10 flex size-11 items-center justify-center rounded-full bg-background/70 backdrop-blur active:scale-95"
          >
            <SwitchCamera className="size-5" />
          </button>
        ) : null}
        {recording ? (
          <p className="absolute inset-x-4 bottom-3 mx-auto w-fit rounded-full border border-border bg-background/80 px-3 py-1.5 text-center text-sm">
            Name it → show it → say the condition
          </p>
        ) : null}
        {phase === "starting" ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Starting camera…</p>
        ) : null}
        {phase === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="max-w-sm">{error}</p>
            <Button
              size="lg"
              onClick={() => {
                setPhase("starting");
                void startCamera();
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {previewPiece && previewSrc ? (
          <div className="absolute inset-0 z-20 flex flex-col bg-black">
            <p className="shrink-0 px-4 py-3 text-center text-sm font-medium">
              Part {previewPiece.n}
              {previewPiece.durationMs !== null ? ` · ${formatDuration(previewPiece.durationMs)}` : ""}
            </p>
            <video key={previewSrc} src={previewSrc} controls autoPlay playsInline className="min-h-0 flex-1 bg-black object-contain" />
            <div className="shrink-0 p-4">
              <Button size="lg" className="w-full" onClick={() => setPreviewN(null)}>
                Back to recording
              </Button>
            </div>
          </div>
        ) : null}
        {showTips ? <TipsOverlay onClose={() => setShowTips(false)} /> : null}
      </div>

      {/* Controls */}
      <div className="shrink-0 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
          {hasPieces ? <PartsStrip pieces={pieces} sourceFor={sourceFor} disabled={recording} onOpen={setPreviewN} /> : null}

          {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
          {unknownLengths && !recording ? (
            <p className="text-sm text-muted-foreground">Checking the length of earlier parts…</p>
          ) : null}
          {capReached ? <p className="text-sm text-amber-fg">10-minute limit reached. Finish, or retake the last part.</p> : null}
          {!recording && cutPiece ? (
            <p className="text-sm text-amber-fg">
              The camera stopped during part {cutPiece.n}, so its video freezes after{" "}
              {formatDuration(cutPiece.videoCutAtMs ?? 0)} (the sound keeps going).
              {cutPiece.n === pieces.at(-1)?.n ? " Retake it to record that part again." : ""}
            </p>
          ) : null}
          {failure ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-border bg-red-bg px-3 py-2 text-sm text-red-fg">
              <span className="min-w-0">{failure}</span>
              <Button variant="outline" size="sm" onClick={() => queue.retryFailed()}>
                Retry upload
              </Button>
            </div>
          ) : null}
          {finishError && !failure ? <p className="text-sm text-red-fg">{finishError}</p> : null}

          {confirmCut ? (
            <div className="flex flex-col gap-2 rounded-md border border-amber-border bg-amber-bg p-3">
              <p className="text-sm text-amber-fg">{confirmCut}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" onClick={() => setConfirmCut(null)}>
                  Go back
                </Button>
                <Button size="lg" onClick={() => void finish(true)}>
                  Finish anyway
                </Button>
              </div>
            </div>
          ) : confirmRetake ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <p className="text-sm">Retake part {pieces.at(-1)?.n}? It will be deleted.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" onClick={() => setConfirmRetake(false)}>
                  Cancel
                </Button>
                <Button variant="destructive-solid" size="lg" onClick={retakeLast}>
                  Delete and retake
                </Button>
              </div>
            </div>
          ) : phase === "finishing" ? (
            <FinishingProgress pieces={pieces} />
          ) : (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1">
              <div className="flex justify-start">
                {recording ? (
                  <Button variant="ghost" size="lg" onClick={() => stopPiece(true)}>
                    Retake part
                  </Button>
                ) : hasPieces ? (
                  <Button variant="outline" size="lg" disabled={stopping} onClick={() => void finish()}>
                    Finish
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <RecordButton
                  mode={recording ? "pause" : "record"}
                  label={recording ? "Pause" : hasPieces ? "Resume" : "Start recording"}
                  disabled={recording ? false : phase !== "idle" || stopping || capReached}
                  onClick={() => (recording ? stopPiece(false) : void startPiece())}
                />
                <span className="text-xs text-muted-foreground">{recording ? "Pause" : hasPieces ? "Resume" : "Record"}</span>
              </div>
              <div className="flex justify-end">
                {!recording && hasPieces ? (
                  <Button variant="ghost" size="lg" disabled={stopping} onClick={() => setConfirmRetake(true)}>
                    Retake last
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The big round shutter: a red dot to record, a pause bar while recording. */
function RecordButton({
  mode,
  label,
  disabled,
  onClick,
}: {
  mode: "record" | "pause";
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-20 items-center justify-center rounded-full border-4 border-foreground p-1.5 transition-opacity active:scale-95 disabled:opacity-40"
    >
      {mode === "record" ? (
        <span className="size-full rounded-full bg-red-fg" />
      ) : (
        <span className="flex size-full items-center justify-center gap-1.5 rounded-full bg-foreground/10">
          <span className="h-6 w-1.5 rounded-sm bg-foreground" />
          <span className="h-6 w-1.5 rounded-sm bg-foreground" />
        </span>
      )}
    </button>
  );
}

const urls = new WeakMap<Blob, string>();
/** One object URL per recorded blob, kept for the life of the page. */
function blobUrl(blob: Blob): string {
  let u = urls.get(blob);
  if (!u) {
    u = URL.createObjectURL(blob);
    urls.set(blob, u);
  }
  return u;
}

/** One tile per part: first-frame thumbnail, "Part N", length. Tap to watch it. */
function PartsStrip({
  pieces,
  sourceFor,
  disabled,
  onOpen,
}: {
  pieces: readonly Piece[];
  sourceFor: (p: Piece) => string | null;
  disabled: boolean;
  onOpen: (n: number) => void;
}) {
  return (
    <ul className="-mx-4 flex gap-3 overflow-x-auto px-4" aria-label="Recorded parts">
      {pieces.map((p) => {
        const src = sourceFor(p);
        return (
          <li key={p.n} className="shrink-0">
            <button
              type="button"
              disabled={disabled || !src}
              onClick={() => onOpen(p.n)}
              aria-label={`Watch part ${p.n}`}
              className="flex w-24 flex-col gap-1.5 text-left disabled:opacity-60"
            >
              <span
                className={cn(
                  "relative block aspect-video w-full overflow-hidden rounded-md border bg-muted",
                  p.state === "failed"
                    ? "border-red-border"
                    : p.videoCutAtMs !== null
                      ? "border-amber-border"
                      : "border-border",
                )}
              >
                {src ? (
                  <video
                    src={`${src}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    tabIndex={-1}
                    className="pointer-events-none size-full object-cover"
                  />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <Play className="size-4 fill-white text-white" />
                </span>
                {p.state === "uploading" ? (
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                    <span className="block h-full bg-white" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                  </span>
                ) : null}
              </span>
              <span className="flex items-baseline justify-between gap-1 text-xs">
                <span className="font-medium">Part {p.n}</span>
                <span className="font-mono text-muted-foreground tabular-nums">
                  {p.durationMs !== null ? formatDuration(p.durationMs) : "–:––"}
                </span>
              </span>
              {p.state === "failed" ? (
                <span className="text-xs text-red-fg">Upload failed</span>
              ) : p.videoCutAtMs !== null ? (
                <span className="text-xs text-amber-fg">Video froze at {formatDuration(p.videoCutAtMs)}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FinishingProgress({ pieces }: { pieces: readonly Piece[] }) {
  const sized = pieces.map((p) => ({ size: p.blob?.size ?? 0, p }));
  const total = sized.reduce((s, x) => s + x.size, 0);
  const done = sized.reduce(
    (s, x) => s + (x.p.state === "uploaded" ? x.size : x.p.state === "uploading" ? x.size * x.p.progress : 0),
    0,
  );
  const allUp = pieces.every((p) => p.state === "uploaded");
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  return (
    <div className="flex flex-col gap-2" role="status">
      <div className="flex justify-between text-sm">
        <span>{allUp ? "Starting processing…" : "Uploading…"}</span>
        <span className="font-mono text-muted-foreground tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-accent">
        <div className="h-full bg-foreground transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
