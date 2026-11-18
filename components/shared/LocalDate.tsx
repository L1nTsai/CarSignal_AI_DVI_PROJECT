"use client";
/**
 * A date in the viewer's own locale and time zone. The server can't know
 * either, so it renders a UTC fallback and the client swaps in the local
 * value after mount (no hydration mismatch).
 */
import { useEffect, useState } from "react";

const OPTS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const OPTS_TIME: Intl.DateTimeFormatOptions = { ...OPTS, hour: "numeric", minute: "2-digit" };

export function LocalDate({ iso, withTime = false }: { iso: string; withTime?: boolean }) {
  const opts = withTime ? OPTS_TIME : OPTS;
  const [text, setText] = useState(() => new Date(iso).toLocaleString("en-US", { ...opts, timeZone: "UTC" }));
  useEffect(() => {
    // Locale and time zone are only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(new Date(iso).toLocaleString(undefined, opts));
  }, [iso, opts]);
  return <time dateTime={iso}>{text}</time>;
}
