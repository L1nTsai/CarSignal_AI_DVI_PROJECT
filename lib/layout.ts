/**
 * Mobile vs desktop layout rules. Pure; safe in client components.
 *
 * Every screen has a mobile and a desktop component (components/mobile/,
 * components/desktop/). Which one renders is decided in two steps:
 *
 *  1. On the server, from the request's device info (lib/device.ts), so the
 *     first HTML is already the right layout: no flash.
 *  2. In the browser, a width fallback: on anything that isn't a phone, a
 *     window narrower than DESKTOP_MIN_WIDTH gets the mobile layout
 *     (components/shared/Responsive.tsx).
 */

/** What the server could tell about the device. "tablet" = decide by width. */
export type Device = "mobile" | "tablet" | "desktop";
export type Layout = "mobile" | "desktop";

/** Same breakpoint as Tailwind `lg`, which the laptop editor was built for. */
export const DESKTOP_MIN_WIDTH = 1024;

/** The layout to render before the browser has measured the window. */
export function initialLayout(device: Device): Layout {
  return device === "desktop" ? "desktop" : "mobile";
}

/** The layout once the window width is known. Phones are always mobile. */
export function layoutFor(device: Device, windowWidth: number): Layout {
  if (device === "mobile") return "mobile";
  return windowWidth >= DESKTOP_MIN_WIDTH ? "desktop" : "mobile";
}
