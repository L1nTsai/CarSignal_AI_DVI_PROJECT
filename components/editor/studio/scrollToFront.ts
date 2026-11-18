/**
 * Scroll a horizontal list so `item` sits at its front (left edge, after the
 * list's own padding). Only the list scrolls, never the page. Smooth unless
 * the viewer prefers reduced motion.
 */
export function scrollToFront(list: HTMLElement, item: HTMLElement) {
  const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
  const left = item.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft - pad;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  list.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
}

/** Scroll a vertical list just enough to show `item` (only the list scrolls). */
export function scrollIntoList(list: HTMLElement, item: HTMLElement) {
  const l = list.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  if (r.top < l.top) list.scrollTop -= l.top - r.top;
  else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
}
