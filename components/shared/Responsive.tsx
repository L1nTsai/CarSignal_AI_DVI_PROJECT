"use client";
/**
 * Renders the mobile or the desktop version of a screen (see lib/layout.ts).
 *
 * The server's guess (from the device) is used for the first render, so the
 * HTML already has the right layout. After hydration the window width can
 * switch a non-phone to mobile when it's narrower than DESKTOP_MIN_WIDTH, and
 * back when it's widened. Only that case can flash.
 *
 * Children read the active layout with useLayout().
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { DESKTOP_MIN_WIDTH, initialLayout, layoutFor, type Device, type Layout } from "@/lib/layout";

const QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;
const LayoutContext = createContext<Layout | null>(null);

function subscribe(cb: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

export function useResolvedLayout(device: Device): Layout {
  return useSyncExternalStore(
    subscribe,
    () => layoutFor(device, window.innerWidth),
    () => initialLayout(device),
  );
}

export function Responsive({ device, mobile, desktop }: { device: Device; mobile: ReactNode; desktop: ReactNode }) {
  const layout = useResolvedLayout(device);
  return <LayoutContext.Provider value={layout}>{layout === "desktop" ? desktop : mobile}</LayoutContext.Provider>;
}

/** The layout the nearest <Responsive> rendered. Throws outside one, to catch wiring mistakes. */
export function useLayout(): Layout {
  const v = useContext(LayoutContext);
  if (!v) throw new Error("useLayout() must be used inside <Responsive>");
  return v;
}
