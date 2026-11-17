/**
 * Local cache of stitched videos, so the N cut_clip jobs of one inspection
 * download stitched.mp4 once instead of N times. Keyed by storage path (files
 * are never overwritten, so a path always means the same bytes). Keeps the
 * most recent few; the worker runs one job at a time, so no locking needed.
 */
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadToFile } from "@/lib/storage";

const DIR = path.join(tmpdir(), "carsignal-stitched-cache");
const KEEP = 3;

const keyFor = (storagePath: string) => storagePath.replace(/[^a-zA-Z0-9._-]/g, "_");

/** Local path of `storagePath`, downloading it if needed. */
export async function getStitched(storagePath: string): Promise<string> {
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, keyFor(storagePath));
  try {
    if ((await stat(file)).size > 0) {
      const now = new Date();
      await utimes(file, now, now);
      return file;
    }
  } catch {}
  const part = `${file}.${process.pid}.part`;
  await downloadToFile(storagePath, part);
  await rename(part, file);
  await prune();
  return file;
}

/** Seed the cache with a file we just produced (process_inspection's stitch). */
export async function putStitched(storagePath: string, localFile: string): Promise<string> {
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, keyFor(storagePath));
  const { copyFile } = await import("node:fs/promises");
  await copyFile(localFile, `${file}.part`);
  await rename(`${file}.part`, file);
  await prune();
  return file;
}

async function prune() {
  const names = (await readdir(DIR)).filter((n) => !n.endsWith(".part"));
  if (names.length <= KEEP) return;
  const withTime = await Promise.all(
    names.map(async (n) => ({ n, t: (await stat(path.join(DIR, n)).catch(() => null))?.mtimeMs ?? 0 })),
  );
  withTime.sort((a, b) => b.t - a.t);
  await Promise.all(withTime.slice(KEEP).map(({ n }) => rm(path.join(DIR, n), { force: true })));
}
