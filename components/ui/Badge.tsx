import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "red" | "amber" | "green" | "blue" | "gray";

const tones: Record<BadgeTone, string> = {
  red: "bg-red-bg text-red-fg border-red-border",
  amber: "bg-amber-bg text-amber-fg border-amber-border",
  green: "bg-green-bg text-green-fg border-green-border",
  blue: "bg-blue-bg text-blue-fg border-blue-border",
  gray: "bg-gray-bg text-gray-fg border-gray-border",
};

export function Badge({
  tone = "gray",
  size = "sm",
  children,
  className,
}: {
  tone?: BadgeTone;
  size?: "sm" | "md";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-sm",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
