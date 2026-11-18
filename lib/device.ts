/**
 * Server-only: classify the request's device for the layout rules in
 * lib/layout.ts. Call getDevice() from a Server Component page and pass the
 * result to <Responsive>. Reading headers makes the page render per request,
 * which these pages already do (their data is live).
 */
import { headers } from "next/headers";
import { userAgentFromString } from "next/server";
import type { Device } from "./layout";

/**
 * `chMobile` is the `Sec-CH-UA-Mobile` client hint (Chromium sends `?1` on
 * phones), more reliable than the UA string. iPadOS Safari reports a desktop
 * UA, so iPads come out as "desktop" and are then sorted by the width fallback.
 */
export function classifyDevice(userAgent: string | null, chMobile: string | null): Device {
  if (chMobile === "?1") return "mobile";
  const { device } = userAgentFromString(userAgent ?? undefined);
  if (device.type === "mobile") return "mobile";
  if (device.type === "tablet") return "tablet";
  return "desktop";
}

export async function getDevice(): Promise<Device> {
  const h = await headers();
  return classifyDevice(h.get("user-agent"), h.get("sec-ch-ua-mobile"));
}
