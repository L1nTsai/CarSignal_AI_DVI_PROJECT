/**
 * Video operations for the worker (plan §7): normalize + stitch recorded
 * pieces, cut clips, grab frames, score sharpness. ffmpeg runs via spawn
 * (worker/lib/ffmpeg.ts); all files live in the caller's temp dir.
 */
import { writeFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp, { type OutputInfo } from "sharp";
import { ffmpeg, probeDisplaySize, probeDurationMs, run } from "./ffmpeg";

export interface FrameSize {
  width: number;
  height: number;
}

export const LANDSCAPE: FrameSize = { width: 1280, height: 720 };
export const PORTRAIT: FrameSize = { width: 720, height: 1280 };

/** Output size for the stitched video, from the first piece's displayed orientation. */
export async function chooseFrameSize(firstPiece: string): Promise<FrameSize> {
  const { width, height } = await probeDisplaySize(firstPiece);
  return height > width ? PORTRAIT : LANDSCAPE;
}

export async function hasAudio(file: string): Promise<boolean> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file,
  ]);
  return stdout.trim() !== "";
}

const secs = (ms: number) => (ms / 1000).toFixed(3);

/** Same encoder settings everywhere, so pieces can be joined with `-c copy`. */
const VIDEO_ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"];
const AUDIO_ENC = ["-c:a", "aac", "-ar", "48000", "-ac", "1", "-b:a", "96k"];

/**
 * Normalize one recorded piece: letterbox/pillarbox into W×H (ffmpeg applies
 * rotation metadata first, so a portrait phone clip in a landscape stitch gets
 * pillarboxed rather than squashed), constant 30 fps, H.264 + mono AAC.
 * Pieces without audio get a silent track so concat stays stream-compatible.
 */
export async function normalizePiece(input: string, output: string, size: FrameSize): Promise<void> {
  const { width: W, height: H } = size;
  const vf =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
  const audio = await hasAudio(input);
  const args = ["-i", input];
  if (!audio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono");
  args.push("-map", "0:v:0", "-map", audio ? "0:a:0" : "1:a:0");
  if (!audio) args.push("-shortest");
  args.push(
    "-vf", vf,
    // Fill timestamp gaps / start at 0 (MediaRecorder audio often starts late).
    "-af", "aresample=async=1:first_pts=0",
    ...VIDEO_ENC, ...AUDIO_ENC,
    "-video_track_timescale", "15360",
    "-movflags", "+faststart",
    output,
  );
  await ffmpeg(args);
}

/** Join normalized pieces (concat demuxer, stream copy). */
export async function concatPieces(pieces: string[], output: string, workDir: string): Promise<void> {
  const list = path.join(workDir, "concat.txt");
  await writeFile(list, pieces.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output]);
}

/** Cut [startMs, endMs) out of the stitched video (frame-accurate re-encode). */
export async function cutClipFile(stitched: string, startMs: number, endMs: number, output: string): Promise<void> {
  await ffmpeg([
    "-ss", secs(startMs), "-i", stitched, "-t", secs(endMs - startMs),
    ...VIDEO_ENC, ...AUDIO_ENC,
    "-movflags", "+faststart",
    output,
  ]);
}

/** Grab one JPEG at `ms`. Returns false if ffmpeg produced no frame (e.g. past the end). */
export async function extractFrameFile(stitched: string, ms: number, output: string): Promise<boolean> {
  await ffmpeg(["-ss", secs(ms), "-i", stitched, "-frames:v", "1", "-q:v", "3", output]);
  try {
    return (await stat(output)).size > 0;
  } catch {
    return false;
  }
}

const LAPLACIAN = [0, 1, 0, 1, -4, 1, 0, 1, 0];

/**
 * Sharpness = variance of the Laplacian on a 640 px-wide grayscale copy.
 * Higher is sharper. The convolution output is offset by 128 so negative
 * responses aren't clipped to 0 by the 8-bit pipeline.
 *
 * Each step is materialized to a raw buffer on purpose: sharp's `stats()`
 * reports on the pipeline's INPUT, so `.convolve().stats()` in one chain
 * silently returns the stats of the unfiltered image.
 */
export async function sharpness(imageFile: string): Promise<number> {
  const grey = await sharp(imageFile)
    .resize({ width: 640 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lap = await sharp(grey.data, { raw: rawInfo(grey.info) })
    .convolve({ width: 3, height: 3, kernel: LAPLACIAN, scale: 1, offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stats = await sharp(lap.data, { raw: rawInfo(lap.info) }).stats();
  const sd = stats.channels[0].stdev;
  return Number.isFinite(sd) ? sd * sd : 0;
}

const rawInfo = (i: OutputInfo) => ({ width: i.width, height: i.height, channels: i.channels as 1 | 2 | 3 | 4 });

export { probeDurationMs };
