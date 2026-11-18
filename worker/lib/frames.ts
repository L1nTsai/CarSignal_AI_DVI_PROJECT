/** Frame grabbing shared by cut_clip and extract_frame. */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { storagePaths } from "@/lib/paths";
import { uploadFile } from "@/lib/storage";
import { extractFrameFile, sharpness } from "./video";

export interface GrabbedFrame {
  id: string;
  timestamp_ms: number;
  storage_path: string;
  sharpness: number;
}

/**
 * Extract the frame at `ms`, score it and upload it to {inspection}/frames/{id}.jpg.
 * Returns null if there is no frame at that time. Frame ids are fresh UUIDs, so
 * uploads never collide with an earlier attempt.
 */
export async function grabFrame(
  inspectionId: string,
  stitched: string,
  ms: number,
  tmpDir: string,
): Promise<GrabbedFrame | null> {
  const id = randomUUID();
  const file = path.join(tmpDir, `frame_${id}.jpg`);
  if (!(await extractFrameFile(stitched, ms, file))) return null;
  const score = await sharpness(file);
  const storage_path = storagePaths.frame(inspectionId, id);
  await uploadFile(storage_path, file, "image/jpeg");
  return { id, timestamp_ms: Math.round(ms), storage_path, sharpness: score };
}
