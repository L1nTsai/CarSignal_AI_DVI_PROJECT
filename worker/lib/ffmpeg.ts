/** ffmpeg / ffprobe via child_process.spawn (plan §7). */
import { spawn } from "node:child_process";

export function run(cmd: "ffmpeg" | "ffprobe", args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.split("\n").slice(-6).join("\n")}`));
    });
  });
}

export const ffmpeg = (args: string[]) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

/** Container duration in ms. */
export async function probeDurationMs(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  const s = Number(stdout.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error(`ffprobe: no duration for ${file}`);
  return Math.round(s * 1000);
}

/** Display size after rotation metadata is applied. */
export async function probeDisplaySize(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate",
    "-of", "json", file,
  ]);
  const s = JSON.parse(stdout).streams?.[0];
  if (!s) throw new Error(`ffprobe: no video stream in ${file}`);
  const rot = Math.abs(Number(s.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ?? s.tags?.rotate ?? 0)) % 180;
  return rot === 90 ? { width: s.height, height: s.width } : { width: s.width, height: s.height };
}
