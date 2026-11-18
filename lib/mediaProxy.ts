/**
 * Streams an object from Supabase Storage to the browser, forwarding `Range`
 * so video seeking works (206 Partial Content), especially on iOS Safari.
 * Server-only. Used by /api/media/[...path] and /api/share/[token]/media/...
 */
import { isOverwritablePath } from "./paths";
import { objectUrl, storageAuthHeaders } from "./storage";

const PASS_THROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

export async function proxyStorageObject(req: Request, storagePath: string): Promise<Response> {
  // identity: Node's fetch would otherwise ask for gzip and silently decompress,
  // leaving the forwarded Content-Length / Content-Range describing other bytes.
  const headers: Record<string, string> = { ...storageAuthHeaders(), "accept-encoding": "identity" };
  const range = req.headers.get("range");
  if (range) headers.range = range;

  const upstream = await fetch(objectUrl(storagePath), {
    method: req.method === "HEAD" ? "HEAD" : "GET",
    headers,
    cache: "no-store",
  });

  if (upstream.status === 404 || upstream.status === 400) {
    // Supabase returns 400 with "not_found" for missing objects.
    return new Response("Not found", { status: 404 });
  }
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 416) {
    return new Response("Media unavailable", { status: 502 });
  }

  const out = new Headers();
  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  // Paths are never overwritten, so responses are immutable — except recording
  // pieces, which a retake replaces in place. Caching those would let the
  // pairing view play (or splice byte ranges from) the old piece.
  out.set(
    "cache-control",
    isOverwritablePath(storagePath) ? "no-store" : "private, max-age=31536000, immutable",
  );

  return new Response(req.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}

/** Reject anything that isn't a plain relative object path. */
export function safeStoragePath(segments: string[]): string | null {
  if (segments.length === 0) return null;
  for (const s of segments) {
    if (!s || s === "." || s === ".." || s.includes("\\") || s.includes("\0")) return null;
  }
  return segments.join("/");
}
