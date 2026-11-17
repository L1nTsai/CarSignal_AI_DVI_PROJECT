/** Inspection state transitions shared by handlers. */
import { sql } from "@/lib/db";

/** processing -> failed with a readable reason. */
export async function markInspectionFailed(inspectionId: string, reason: string) {
  await sql`
    update inspections
    set status = 'failed', processing_step = null, failure_reason = ${reason}
    where id = ${inspectionId} and status = 'processing'`;
}

export async function setProcessingStep(inspectionId: string, step: "converting" | "analyzing" | "cutting") {
  await sql`
    update inspections set processing_step = ${step}
    where id = ${inspectionId} and status = 'processing'`;
}

/**
 * Plan §7 cut_clip step 7: once no clip is pending, processing -> ready_for_review.
 * Safe to call any time; it's a no-op unless the inspection is in 'cutting'.
 */
export async function maybeFinishProcessing(inspectionId: string) {
  await sql`
    update inspections
    set status = 'ready_for_review', processing_step = null
    where id = ${inspectionId}
      and status = 'processing' and processing_step = 'cutting'
      and not exists (select 1 from clips where inspection_id = ${inspectionId} and status = 'pending')`;
}
