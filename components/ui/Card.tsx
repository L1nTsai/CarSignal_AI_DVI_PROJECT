import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Bordered, flat container. No shadow. */
export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-lg border border-border bg-background", className)} {...rest} />;
}
