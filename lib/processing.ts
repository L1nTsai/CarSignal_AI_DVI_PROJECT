/** Shared by the cancel route and the inspection page. Pure; client-safe. */

/** failure_reason set by POST /api/inspections/[id]/cancel. */
export const CANCELLED_REASON = "Processing was cancelled.";

/** A cancelled inspection is final: it can't be retried, only deleted. */
export function isCancelled(failureReason: string | null): boolean {
  return failureReason === CANCELLED_REASON;
}

/** Cancel is offered during converting and AI review; cutting is quick and the lines are already saved. */
export function canCancelProcessing(step: string | null): boolean {
  return step === "converting" || step === "analyzing";
}
