/**
 * The AI step (plan §8), as seen by the worker. PLACEHOLDER — the AI agent
 * delivers the real `analyzeInspection: AnalyzeFn` (lib/ai/types.ts); swap the
 * body of `analyze` for a call to it. The worker still runs
 * assertValidatedAnalysis() on whatever comes back.
 */
import type { AnalyzeFn } from "@/lib/ai/types";
import { JobError } from "../errors";

export const analyze: AnalyzeFn = async () => {
  throw new JobError("analyzeInspection is not wired in yet (AI agent)", {
    retryable: false,
    userMessage: "The AI step isn't available yet.",
  });
};
