/**
 * extract_frame (plan §7): grab the frame at job.frame_timestamp_ms ("Use
 * current frame" in the clip panel), score it, insert it as 'tech_picked' and
 * make it the clip's thumbnail.
 */
import { sql, withActor } from "@/lib/db";
import { removeObjects } from "@/lib/storage";
import { JobError } from "../errors";
import { grabFrame } from "../lib/frames";
import { getStitched } from "../lib/stitchedCache";
import type { JobHandler } from "../types";

/** Seeking to the very last ms can yield no frame; stay this far inside. */
const END_GUARD_MS = 100;

export const extractFrame: JobHandler = {
  async run(job, ctx) {
    if (!job.clip_id || job.frame_timestamp_ms === null) {
      throw new JobError("extract_frame without clip_id / frame_timestamp_ms", { retryable: false });
    }
    const [clip] = await sql<{ id: string; inspection_id: string; video_path: string | null; duration_ms: number | null }[]>`
      select c.id, c.inspection_id, i.video_path, i.duration_ms
      from clips c join inspections i on i.id = c.inspection_id
      where c.id = ${job.clip_id}`;
    if (!clip) {
      ctx.log("clip no longer exists; nothing to do", { clip_id: job.clip_id });
      return;
    }
    if (!clip.video_path || !clip.duration_ms) {
      throw new JobError("inspection has no stitched video", { retryable: false });
    }

    const t = Math.max(0, Math.min(job.frame_timestamp_ms, clip.duration_ms - END_GUARD_MS));
    const stitched = await getStitched(clip.video_path);
    const frame = await grabFrame(clip.inspection_id, stitched, t, ctx.tmpDir);
    if (!frame) throw new JobError(`no frame at ${t} ms`, { retryable: false });

    // 'tech', not 'ai': this job only exists because the tech pressed "Use current
    // frame", so the thumbnail change is their edit (it must count as an unsent change).
    const saved = await withActor("tech", async (tx) => {
      const [cur] = await tx`select id from clips where id = ${clip.id} for update`;
      if (!cur) return false;
      await tx`
        insert into frames (id, clip_id, timestamp_ms, storage_path, origin, sharpness)
        values (${frame.id}, ${clip.id}, ${frame.timestamp_ms}, ${frame.storage_path}, 'tech_picked', ${frame.sharpness})`;
      await tx`update clips set thumbnail_frame_id = ${frame.id} where id = ${clip.id}`;
      return true;
    });
    if (!saved) {
      await removeObjects([frame.storage_path]).catch(() => {});
      ctx.log("clip deleted while extracting; frame discarded", { clip_id: clip.id });
      return;
    }
    ctx.log("frame picked", { clip_id: clip.id, frame_id: frame.id, t, sharpness: frame.sharpness });
  },
};
