/**
 * Media URL builders. Pure; safe in client components.
 *
 * The browser never talks to Supabase. Tech pages use /api/media/{storage path};
 * the customer page uses token-scoped URLs so storage paths (which contain the
 * inspection id = edit URL) are never exposed to customers.
 */

export function mediaUrl(storagePath: string): string {
  return `/api/media/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function shareMediaUrl(token: string, versionClipId: string, kind: "clip" | "thumbnail"): string {
  return `/api/share/${encodeURIComponent(token)}/media/${versionClipId}/${kind}`;
}
