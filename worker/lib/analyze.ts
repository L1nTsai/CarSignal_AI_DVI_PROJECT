/**
 * The AI step (plan §8), as seen by the worker: the real Gemini analyzer from
 * lib/ai. process_inspection still runs assertValidatedAnalysis() on the result.
 */
export { analyzeInspection as analyze } from "@/lib/ai/analyze";
