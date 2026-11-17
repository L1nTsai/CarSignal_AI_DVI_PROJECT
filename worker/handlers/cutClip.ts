/**
 * cut_clip (plan §7).
 *
 *  1. Read the clip's CURRENT start/end (the tech may have changed them).
 *  2. Cut from stitched.mp4, upload to {inspection}/clips/{clip}/{cut_count+1}.mp4.
 *  3. Candidate frames (lib/clips/frames.ts), sharpness, upload, insert as
 *     'ai_candidate'.
 *  4. Thumbnail -> sharpest new frame if there is none or it is out of range.
 *  5. status 'ready', path, cut_count += 1; then maybe finish processing.
 *
 * If the range changed while we were cutting, the result is stale: a newer
 * cut_clip job is already queued (PATCH queues one), so we discard ours.
 */
import path from "node:path";
import { candidateFrameTimes, needsNewThumbnail, sharpestIndex } from "@/lib/clips";
import { sql, withActor } from "@/lib/db";
import { storagePaths } from "@/lib/paths";
import { removeObjects, uploadFile } from "@/lib/storage";
import { JobError } from "../errors";
import { grabFrame, type GrabbedFrame } from "../lib/frames";
import { maybeFinishProcessing } from "../lib/inspection";
import { getStitched } from "../lib/stitchedCache";
import { cutClipFile } from "../lib/video";
import type { JobHandler } from "../types";

interface ClipForCut {
  id: string;
  inspection_id: string;
  start_ms: number;
  end_ms: number;
  cut_count: number;
  best_frame_ms: number | null;
  video_path: string | null;
}

export const cutClip: JobHandler = {
  async run(job, ctx) {
    if (!job.clip_id) throw new JobError("cut_clip without clip_id", { retryable: false });
    const [clip] = await sql<ClipForCut[]>`
      select c.id, c.inspection_id, c.start_ms, c.end_ms, c.cut_count, m.best_frame_ms, i.video_path
      from clips c
      join inspections i on i.id = c.inspection_id
      left join mentions m on m.id = c.mention_id
      where c.id = ${job.clip_id}`;
    if (!clip) {
      ctx.log("clip no longer exists; nothing to do", { clip_id: job.clip_id });
      return;
    }
    if (!clip.video_path) throw new JobError("inspection has no stitched video", { retryable: false });

    const stitched = await getStitched(clip.video_path);
    const cutNumber = clip.cut_count + 1;
    const clipPath = storagePaths.clip(clip.inspection_id, clip.id, cutNumber);
    const local = path.join(ctx.tmpDir, `clip_${cutNumber}.mp4`);
    await cutClipFile(stitched, clip.start_ms, clip.end_ms, local);

    const range = { start_ms: clip.start_ms, end_ms: clip.end_ms };
    const frames: GrabbedFrame[] = [];
    for (const t of candidateFrameTimes(range, clip.best_frame_ms)) {
      const f = await grabFrame(clip.inspection_id, stitched, t, ctx.tmpDir);
      if (f) frames.push(f);
    }
    if (frames.length === 0) throw new Error(`no frames could be extracted for clip ${clip.id}`);

    // This path isn't referenced until the update below, so clearing a leftover
    // from a crashed attempt is safe (files that ARE referenced are never touched).
    await removeObjects([clipPath]);
    await uploadFile(clipPath, local, "video/mp4");

    const outcome = await withActor("ai", async (tx) => {
      const [cur] = await tx<{ start_ms: number; end_ms: number; cut_count: number; thumb_ms: number | null }[]>`
        select c.start_ms, c.end_ms, c.cut_count, f.timestamp_ms as thumb_ms
        from clips c left join frames f on f.id = c.thumbnail_frame_id
        where c.id = ${clip.id}
        for update of c`;
      if (!cur) return "gone" as const;
      if (cur.start_ms !== clip.start_ms || cur.end_ms !== clip.end_ms || cur.cut_count !== clip.cut_count) {
        return "stale" as const;
      }

      const rows = frames.map((f) => ({
        id: f.id,
        clip_id: clip.id,
        timestamp_ms: f.timestamp_ms,
        storage_path: f.storage_path,
        origin: "ai_candidate",
        sharpness: f.sharpness,
      }));
      await tx`insert into frames ${tx(rows, "id", "clip_id", "timestamp_ms", "storage_path", "origin", "sharpness")}`;

      const best = frames[sharpestIndex(frames.map((f) => f.sharpness))];
      if (needsNewThumbnail(range, cur.thumb_ms)) {
        await tx`update clips set status = 'ready', path = ${clipPath}, cut_count = ${cutNumber},
                                  thumbnail_frame_id = ${best.id}
                 where id = ${clip.id}`;
      } else {
        await tx`update clips set status = 'ready', path = ${clipPath}, cut_count = ${cutNumber}
                 where id = ${clip.id}`;
      }
      return "ready" as const;
    });

    if (outcome !== "ready") {
      ctx.log(`discarding cut: clip ${outcome}`, { clip_id: clip.id });
      await removeObjects([clipPath, ...frames.map((f) => f.storage_path)]).catch(() => {});
      return;
    }
    ctx.log("clip ready", { clip_id: clip.id, path: clipPath, frames: frames.length, range });
    await maybeFinishProcessing(clip.inspection_id);
  },

  async onFinalFailure(job) {
    if (!job.clip_id) return;
    await sql`update clips set status = 'failed' where id = ${job.clip_id} and status = 'pending'`;
    await maybeFinishProcessing(job.inspection_id);
  },
};
