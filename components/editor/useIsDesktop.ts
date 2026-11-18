"use client";
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

/** True on laptop-width screens (Tailwind `lg`). False during SSR. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
