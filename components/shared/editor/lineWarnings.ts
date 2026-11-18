/**
 * Warnings shown on a line in both editors (plan §10): unsupported numbers
 * (grounding check), an inferred rating, failed clips, no clips, empty note.
 * Pure; safe in client components.
 */
import { unsupportedNumbers } from "@/lib/ai/grounding";
import type { LineDetail } from "@/lib/types/api";

export function lineWarnings(line: LineDetail): string[] {
  const out: string[] = [];
  if (line.source === "ai") {
    const nums = unsupportedNumbers(
      line.note,
      line.mentions.map((m) => m.quote),
    );
    if (nums.length) {
      const list = nums.length === 1 ? nums[0] : `${nums.slice(0, -1).join(", ")} and ${nums.at(-1)}`;
      out.push(`The note mentions ${list}, but you didn't say that.`);
    }
    const ai = line.ai_suggestion;
    if (ai?.rating_basis === "inferred" && line.rating === ai.rating) {
      out.push("You didn't say a rating out loud; the AI guessed it from your words. Check it.");
    }
  }
  for (const c of line.clips) {
    if (c.status === "failed") out.push(`Clip ${c.position} couldn't be cut. Open the clips to retry.`);
  }
  if (line.clips.length === 0) out.push("No clips yet. Every line needs one before sending.");
  if (line.note.trim() === "") out.push("Add a note before sending.");
  return out;
}
