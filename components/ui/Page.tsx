import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Page layout: sticky top bar (brand or back link, title, actions) + centered
 * content column with a 16 px phone gutter.
 *
 * width: "narrow" (640 px, phone-first pages, customer report),
 *        "wide" (1200 px, laptop editor with two columns).
 */
export function Page({
  title,
  back,
  actions,
  width = "narrow",
  children,
  footer,
}: {
  title?: ReactNode;
  back?: { href: string; label?: string };
  actions?: ReactNode;
  width?: "narrow" | "wide";
  children: ReactNode;
  /** Sticky bottom bar (e.g. Send to customer). */
  footer?: ReactNode;
}) {
  const max = width === "wide" ? "max-w-[1200px]" : "max-w-[640px]";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className={cn("mx-auto flex h-14 w-full items-center gap-3 px-4", max)}>
          {back ? (
            <Link href={back.href} className="-ml-2 rounded-md px-2 py-1 text-sm text-muted hover:text-foreground">
              ← {back.label ?? "Back"}
            </Link>
          ) : (
            <Link href="/" className="text-sm font-semibold tracking-tight">
              CarSignal
            </Link>
          )}
          {title ? <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1> : <div className="flex-1" />}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <main className={cn("mx-auto w-full flex-1 px-4 py-6", max)}>{children}</main>
      {footer ? (
        <div className="sticky bottom-0 z-10 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
          <div className={cn("mx-auto w-full px-4 py-3", max)}>{footer}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Section with a small heading, used to group content within a page. */
export function Section({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      {title || actions ? (
        <div className="flex items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-medium text-muted">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Centered empty / error / loading message. */
export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="text-sm text-muted">{children}</div> : null}
    </div>
  );
}
