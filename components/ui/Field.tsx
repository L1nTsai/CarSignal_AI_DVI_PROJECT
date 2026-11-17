import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-md border border-border bg-background px-3 text-base text-foreground " +
  "placeholder:text-subtle hover:border-border-strong focus:border-foreground focus:outline-none " +
  "disabled:opacity-50 aria-invalid:border-red-fg";

// text-base (16 px) on inputs keeps iOS Safari from zooming on focus.
export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(control, "h-12", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2.5", className)} {...rest} />;
}

/** Label + control + optional hint/error, stacked. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-red-fg">{error}</p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
