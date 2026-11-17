/**
 * Why "Send to customer" would fail, computed on the client from
 * InspectionDetail so the button can be disabled with a list of reasons.
 * Pure; safe in client components.
 *
 * This mirrors send_report() in supabase/migrations/0001_init.sql, which stays
 * the source of truth: the server still runs every check and returns 409 with
 * the database message if anything slipped through.
 */
import type { InspectionDetail } from "../types/api";

type DetailForSend = Pick<InspectionDetail, "inspection" | "lines" | "sending">;

const DETAIL_FIELDS = [
  ["customer_name", "customer name"],
  ["vehicle_year", "year"],
  ["vehicle_make", "make"],
  ["vehicle_model", "model"],
  ["vin", "VIN"],
] as const;

/** Reasons written for the tech. Empty array = Send can go ahead. */
export function sendBlockers(d: DetailForSend): string[] {
  const { inspection: insp, lines } = d;
  if (insp.status !== "ready_for_review" && insp.status !== "sent") {
    return ["The inspection isn't ready to send yet."];
  }

  const reasons: string[] = [];
  const missing = DETAIL_FIELDS.filter(([k]) => insp[k] === null || insp[k] === "").map(([, label]) => label);
  if (missing.length > 0) reasons.push(`Add the ${joinList(missing)}.`);

  if (lines.length === 0) {
    reasons.push("Add at least one line.");
    return reasons;
  }

  for (const l of lines) {
    const name = l.component_name.trim() || `Line ${l.position}`;
    if (l.note.trim() === "") reasons.push(`“${name}” needs a note.`);
    if (l.clips.length === 0) {
      reasons.push(`“${name}” needs a clip.`);
      continue;
    }
    if (l.clips.some((c) => c.status === "pending")) reasons.push(`“${name}” has a clip that's still being cut.`);
    if (l.clips.some((c) => c.status === "failed")) reasons.push(`“${name}” has a clip that failed. Retry or delete it.`);
    if (l.clips.some((c) => c.status === "ready" && c.thumbnail_frame_id === null)) {
      reasons.push(`“${name}” has a clip without a photo.`);
    }
  }

  if (reasons.length === 0 && insp.status === "sent" && !d.sending.unsent_changes) {
    const v = d.sending.latest_version?.version_number;
    reasons.push(`Nothing has changed since version ${v ?? "1"}.`);
  }
  return reasons;
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
