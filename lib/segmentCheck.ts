/**
 * Server-only check of an uploaded recording piece (plan §6, migration 0007):
 * does the picture run as long as the sound? iOS can take the camera away from
 * Safari mid-take while the microphone keeps recording, which leaves a piece
 * that freezes on its last frame. Reads the file straight from Storage with
 * ffprobe (packet timestamps only, no decoding).
 */
import { execFile } from "node:child_process";
import { env } from "./env";
import { videoCutAt } from "./recording";
import { objectUrl } from "./storage";

interface ProbeJson {
  streams?: { index: number; codec_type?: string }[];
  packets?: { stream_index: number; pts_time?: string; duration_time?: string }[];
}

/**
 * One packet counts for at most this long. When iOS takes the camera, Safari
 * writes the last frame with a duration that covers the rest of the take
 * (99 s on a real one), which would hide the gap.
 */
const MAX_PACKET_S = 0.5;

/** End of each track in ms (last packet's pts + its capped duration), from ffprobe JSON. */
export function trackEnds(probe: ProbeJson): { videoEndMs: number | null; audioEndMs: number | null } {
  const kind = new Map((probe.streams ?? []).map((s) => [s.index, s.codec_type]));
  let videoEnd: number | null = null;
  let audioEnd: number | null = null;
  for (const p of probe.packets ?? []) {
    const pts = Number(p.pts_time);
    if (!Number.isFinite(pts)) continue;
    const dur = Number(p.duration_time);
    const end = (pts + (Number.isFinite(dur) ? Math.min(Math.max(dur, 0), MAX_PACKET_S) : 0)) * 1000;
    const k = kind.get(p.stream_index);
    if (k === "video") videoEnd = Math.max(videoEnd ?? 0, end);
    else if (k === "audio") audioEnd = Math.max(audioEnd ?? 0, end);
  }
  return { videoEndMs: videoEnd, audioEndMs: audioEnd };
}

/**
 * Where the piece's picture stops while its sound continues, or null if they
 * end together. Throws if ffprobe fails; callers treat that as "not checked".
 */
export async function checkSegmentVideo(storagePath: string): Promise<number | null> {
  const key = env().SUPABASE_SERVICE_ROLE_KEY;
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "error",
        "-headers", `authorization: Bearer ${key}\r\napikey: ${key}\r\n`,
        "-show_entries", "stream=index,codec_type:packet=stream_index,pts_time,duration_time",
        "-of", "json",
        objectUrl(storagePath),
      ],
      { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 },
      (err, out) => (err ? reject(err) : resolve(out)),
    );
  });
  const { videoEndMs, audioEndMs } = trackEnds(JSON.parse(stdout) as ProbeJson);
  return videoCutAt(videoEndMs, audioEndMs);
}
