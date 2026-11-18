/**
 * Server-only: the address customer links (and the pairing QR code) should use.
 *
 * `PUBLIC_BASE_URL` wins when it is a real address. When it's a localhost
 * address (the default, and what `.env.local` has before a tunnel is set up),
 * a link built from it can't be opened on a phone, so use the address this
 * request came in on instead (the tunnel, when the tech opened the app
 * through it). A quick tunnel's address changes on every run, so this keeps
 * the links right without editing `.env.local` each time.
 *
 * Outside a request (worker, scripts) this is just `PUBLIC_BASE_URL`.
 */
import { headers } from "next/headers";
import { env } from "./env";

/** localhost, 127.x.x.x, ::1, 0.0.0.0 and *.localhost: not reachable from another device. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0" || /^127\./.test(h);
}

/** Pure part: pick the base from the configured value and the request's host headers. */
export function pickBaseUrl(
  configured: string,
  req: { host: string | null; forwardedHost: string | null; forwardedProto: string | null },
): string {
  const base = configured.replace(/\/+$/, "");
  try {
    if (!isLocalHost(new URL(base).hostname)) return base;
  } catch {
    return base;
  }
  // x-forwarded-host can list several hosts (one per proxy); the first is the one the browser used.
  const host = (req.forwardedHost ?? req.host)?.split(",")[0]?.trim();
  if (!host || !/^[A-Za-z0-9.-]+(:\d+)?$/.test(host) || isLocalHost(host.split(":")[0])) return base;
  const proto = req.forwardedProto?.split(",")[0]?.trim() === "http" ? "http" : "https";
  return `${proto}://${host}`;
}

export async function publicBaseUrl(): Promise<string> {
  const configured = env().PUBLIC_BASE_URL;
  try {
    const h = await headers();
    return pickBaseUrl(configured, {
      host: h.get("host"),
      forwardedHost: h.get("x-forwarded-host"),
      forwardedProto: h.get("x-forwarded-proto"),
    });
  } catch {
    return configured; // not in a request
  }
}
