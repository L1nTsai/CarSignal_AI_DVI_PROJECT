/** Shared by the cancel route and the inspection page. Pure; client-safe. */

/** Cancel is offered during converting and AI review; cutting is quick and the lines are already saved. */
export function canCancelProcessing(step: string | null): boolean {
  return step === "converting" || step === "analyzing";
}
