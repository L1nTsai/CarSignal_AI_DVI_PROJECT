/**
 * process_inspection (plan §7): converting -> analyzing -> saving -> cutting.
 * PLACEHOLDER — owned by the pipeline/AI agents.
 *
 * Steps to implement:
 *  1. converting (skip if inspection.video_path is set): download segments,
 *     normalize, concat -> stitched.mp4, upload, save durations/offsets.
 *  2. analyzing: analyzeInspection(input: AnalyzeInput) -> ValidatedAnalysis
 *     (lib/ai/types.ts), then assertValidatedAnalysis(), then grounding check.
 *  3. saving: withActor('ai', tx => ...) delete old lines, insert line_items /
 *     ai_suggestions / mentions / clips (pending), set step 'cutting', queue cut_clip jobs.
 */
import { JobError } from "../errors";
import { markInspectionFailed } from "../lib/inspection";
import type { JobHandler } from "../types";

export const processInspection: JobHandler = {
  async run(job, ctx) {
    ctx.log("process_inspection placeholder", { inspection_id: job.inspection_id });
    throw new JobError("process_inspection is not implemented yet", {
      retryable: false,
      userMessage: "Processing isn't available yet.",
    });
  },

  async onFinalFailure(job, error) {
    const reason =
      error instanceof JobError && error.userMessage
        ? error.userMessage
        : "Processing failed. Try again, or record the inspection again.";
    await markInspectionFailed(job.inspection_id, reason);
  },
};
