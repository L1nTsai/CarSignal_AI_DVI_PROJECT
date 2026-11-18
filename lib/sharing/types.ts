/**
 * API shapes owned by the sharing feature. Pure types; safe in client components.
 * (Kept here rather than lib/types/api.ts, which is a foundation contract.)
 */

// ── POST /api/inspections/[id]/send ─────────────────────────────────────────
// Errors: 404 unknown inspection; 409 { error } with send_report's message.
export interface SendResponse {
  /** `${PUBLIC_BASE_URL}/r/${share_token}`. Same URL for every version. */
  shareUrl: string;
  version_number: number;
}
