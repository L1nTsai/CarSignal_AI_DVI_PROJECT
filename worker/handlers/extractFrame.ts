/**
 * extract_frame (plan §7). PLACEHOLDER — owned by the clips/frames agent.
 *
 * Steps to implement: extract the frame at job.frame_timestamp_ms from
 * stitched.mp4, score sharpness, upload to storagePaths.frame(...), insert a
 * frames row (origin 'tech_picked'), and make it the clip's thumbnail.
 */
import { JobError } from "../errors";
import type { JobHandler } from "../types";

export const extractFrame: JobHandler = {
  async run(job, ctx) {
    ctx.log("extract_frame placeholder", { clip_id: job.clip_id, t: job.frame_timestamp_ms });
    throw new JobError("extract_frame is not implemented yet", { retryable: false });
  },
};
