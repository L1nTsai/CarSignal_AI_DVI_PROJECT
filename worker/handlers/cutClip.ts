/**
 * cut_clip (plan §7). PLACEHOLDER — owned by the clips/frames agent.
 *
 * Steps to implement: read the clip's CURRENT start/end, cut from stitched.mp4,
 * upload to storagePaths.clip(inspection, clip, cut_count + 1), extract ~5
 * candidate frames + sharpness, insert frames (ai_candidate), set thumbnail if
 * missing/out of range, set status 'ready' + path + cut_count += 1, then
 * maybeFinishProcessing(). Use withActor('ai', ...) for clip updates.
 */
import { sql } from "@/lib/db";
import { JobError } from "../errors";
import { maybeFinishProcessing } from "../lib/inspection";
import type { JobHandler } from "../types";

export const cutClip: JobHandler = {
  async run(job, ctx) {
    ctx.log("cut_clip placeholder", { clip_id: job.clip_id });
    throw new JobError("cut_clip is not implemented yet", { retryable: false });
  },

  async onFinalFailure(job) {
    if (!job.clip_id) return;
    await sql`update clips set status = 'failed' where id = ${job.clip_id} and status = 'pending'`;
    await maybeFinishProcessing(job.inspection_id);
  },
};
