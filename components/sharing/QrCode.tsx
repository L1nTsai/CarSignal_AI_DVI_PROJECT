"use client";
/** QR code for a URL, rendered in the browser with the `qrcode` package. */
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export function QrCode({ value, size = 200, className }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Always dark on white, whatever the theme, so every phone camera reads it.
    QRCode.toString(value, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((s) => !cancelled && setSvg(s))
      .catch(() => !cancelled && setSvg(null));
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      role="img"
      aria-label={`QR code for ${value}`}
      style={{ width: size, height: size }}
      className={cn("overflow-hidden rounded-md border border-border bg-white [&>svg]:size-full", className)}
      // qrcode's own SVG output for a URL we built; no user HTML.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
