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
 * - Finish waits for uploads, calls /finish, then opens the inspection.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDuration, MIN_PIECE_MS, pickMimeType, VIDEO_BITS_PER_SECOND } from "@/lib/recording";
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
}

type Phase = "starting" | "idle" | "recording" | "finishing" | "error";

interface Session {
  rec: MediaRecorder;
  startedAt: number;
  stoppedAt: number | null;
  discard: boolean;
}

const CAMERA: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  audio: true,
};

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
    q.seed(boot.keep.map((s) => ({ n: s.n, durationMs: null, mimeType: s.mimeType })));
    return q;
  });
  const pieces = useSyncExternalStore(queue.subscribe, queue.getPieces, queue.getPieces);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>("");
  const sessionRef = useRef<Session | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const seededRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const tipsPrefHidden = useSyncExternalStore(noopSubscribe, tipsHidden, () => true);
  const [tipsOpen, setTipsOpen] = useState<boolean | null>(null); // null = default
  const showTips = tipsOpen ?? (!tipsPrefHidden && boot.keep.length === 0);
  const setShowTips = setTipsOpen;
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [stopping, setStopping] = useState(false); // waiting for MediaRecorder's onstop
  const [capHit, setCapHit] = useState(false); // set when the timer stops at the cap
  const [notice, setNotice] = useState<string | null>(boot.notice);
  const [finishError, setFinishError] = useState<string | null>(null);
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
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA);
      streamRef.current = stream;
      for (const track of stream.getTracks()) {
        track.onended = () => {
          if (sessionRef.current) stopPiece(false);
          setError("The camera stopped. Start it again to keep recording.");
          setPhase("error");
        };
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setError(null);
      setPhase("idle");
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

  const startPiece = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream || sessionRef.current || capReached) return;
    setNotice(null);
    setFinishError(null);
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mimeRef.current, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    } catch {
      setError("Recording couldn't start. Reload the page and try again.");
      setPhase("error");
      return;
    }
    const s: Session = { rec, startedAt: performance.now(), stoppedAt: null, discard: false };
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      setStopping(false);
      if (s.discard) return;
      const durationMs = Math.round((s.stoppedAt ?? performance.now()) - s.startedAt);
      const type = rec.mimeType || mimeRef.current;
      const blob = new Blob(chunks, { type });
      if (blob.size === 0 || durationMs < MIN_PIECE_MS) return;
      queue.add(blob, type, durationMs);
    };
    rec.onerror = () => {
      stopPiece(false);
      setNotice("Recording stopped unexpectedly. What was recorded so far is saved.");
    };
    sessionRef.current = s;
    rec.start();
    setPieceStartedAt(s.startedAt);
    setNow(s.startedAt);
    setPhase("recording");
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {}
  }, [capReached, queue, stopPiece]);

  // ── Timer + cap ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      const t = performance.now();
      setNow(t);
      const kept = queue.getPieces().reduce((sum, p) => sum + (p.durationMs ?? 0), 0);
      if (kept + (t - s.startedAt) >= maxMs) {
        stopPiece(false);
        setCapHit(true);
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, maxMs, queue, stopPiece]);


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

  const finish = async () => {
    setFinishError(null);
    setPhase("finishing");
    const ok = await queue.waitIdle();
    if (!ok) {
      setFinishError(queue.failureMessage ?? "Some parts didn't upload.");
      setPhase("idle");
      return;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/finish`, { method: "POST" });
        if (res.ok) break;
        const body = await res.json().catch(() => null);
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

  // ── Render ────────────────────────────────────────────────────────────────
  const recording = phase === "recording";
  const hasPieces = pieces.length > 0;
  const failure = queue.failureMessage;
  const canExit = !recording && phase !== "finishing" && queue.settled && !stopping;

  return (
    <div className="theme-dark fixed inset-0 flex flex-col">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
        <div className="w-20">
          {canExit ? (
            <Link href={`/inspections/${inspectionId}`} className="text-sm text-muted hover:text-foreground">
              ← Exit
            </Link>
          ) : null}
        </div>
        <div className="flex flex-1 items-center justify-center gap-2 font-mono text-sm tabular-nums" aria-live="off">
          {recording ? <span aria-hidden className="size-2 rounded-full bg-red-fg" /> : null}
          <span>{formatDuration(totalMs)}</span>
          <span className="text-subtle">/ {formatDuration(maxMs)}</span>
        </div>
        <div className="flex w-20 justify-end">
          {!recording && phase !== "finishing" ? (
            <button type="button" onClick={() => setShowTips(true)} className="text-sm text-muted hover:text-foreground">
              Tips
            </button>
          ) : null}
        </div>
      </div>

      {/* Camera */}
      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} muted playsInline autoPlay className="absolute inset-0 h-full w-full" />
        {recording ? (
          <p className="absolute inset-x-4 bottom-3 mx-auto w-fit rounded-full border border-border bg-background/80 px-3 py-1.5 text-center text-sm">
            Name it → show it → say the condition
          </p>
        ) : null}
        {phase === "starting" ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">Starting camera…</p>
        ) : null}
        {phase === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="max-w-sm">{error}</p>
            <Button
              variant="primary"
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
        {showTips ? <TipsOverlay onClose={() => setShowTips(false)} /> : null}
      </div>

      {/* Controls */}
      <div className="shrink-0 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
          {hasPieces ? <PartsStrip pieces={pieces} /> : null}

          {notice ? <p className="text-sm text-muted">{notice}</p> : null}
          {unknownLengths && !recording ? (
            <p className="text-sm text-muted">Checking the length of earlier parts…</p>
          ) : null}
          {capReached ? <p className="text-sm text-amber-fg">10-minute limit reached. Finish, or retake the last part.</p> : null}
          {failure ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-border bg-red-bg px-3 py-2 text-sm text-red-fg">
              <span className="min-w-0">{failure}</span>
              <Button size="sm" onClick={() => queue.retryFailed()}>
                Retry upload
              </Button>
            </div>
          ) : null}
          {finishError && !failure ? <p className="text-sm text-red-fg">{finishError}</p> : null}

          {confirmRetake ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <p className="text-sm">Retake part {pieces.at(-1)?.n}? It will be deleted.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" onClick={() => setConfirmRetake(false)}>
                  Cancel
                </Button>
                <Button variant="danger" size="lg" onClick={retakeLast}>
                  Delete and retake
                </Button>
              </div>
            </div>
          ) : recording ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" onClick={() => stopPiece(true)}>
                Retake part
              </Button>
              <Button variant="primary" size="lg" onClick={() => stopPiece(false)}>
                Pause
              </Button>
            </div>
          ) : phase === "finishing" ? (
            <FinishingProgress pieces={pieces} />
          ) : !hasPieces ? (
            <Button variant="primary" size="lg" full disabled={phase !== "idle" || stopping} onClick={() => void startPiece()}>
              Start recording
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" disabled={stopping} onClick={() => void finish()}>
                  Finish
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={phase !== "idle" || stopping || capReached}
                  onClick={() => void startPiece()}
                >
                  Resume
                </Button>
              </div>
              <Button variant="ghost" size="md" disabled={stopping} onClick={() => setConfirmRetake(true)}>
                Retake last part
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<Piece["state"], string> = {
  queued: "Waiting",
  uploading: "Uploading",
  uploaded: "Uploaded",
  failed: "Failed",
};

function PartsStrip({ pieces }: { pieces: readonly Piece[] }) {
  return (
    <ul className="-mx-4 flex gap-2 overflow-x-auto px-4" aria-label="Recorded parts">
      {pieces.map((p) => (
        <li
          key={p.n}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
            p.state === "failed" ? "border-red-border text-red-fg" : "border-border",
          )}
        >
          <span className="font-medium">Part {p.n}</span>
          <span className="font-mono text-muted tabular-nums">{p.durationMs !== null ? formatDuration(p.durationMs) : "–:––"}</span>
          <span className={cn(p.state === "uploaded" ? "text-green-fg" : p.state === "failed" ? "" : "text-muted")}>
            {p.state === "uploading" ? `${Math.round(p.progress * 100)}%` : STATE_LABEL[p.state]}
          </span>
        </li>
      ))}
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
        <span className="font-mono text-muted tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full bg-foreground transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
