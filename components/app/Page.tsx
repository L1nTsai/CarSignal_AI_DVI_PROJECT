import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Page layout: sticky top bar (brand or back link, title, actions) + centered
 * content column with a 16 px phone gutter.
 *
 * width: "narrow" (640 px, phone-first pages, customer report),
 *        "wide" (1200 px, the inspection grid),
 *        "full" (edge to edge, the laptop clip studio).
 * fill: the page is exactly one screen tall and `main` doesn't scroll;
 *       the content lays itself out in the remaining height.
 */
export function Page({
  title,
  back,
  actions,
  width = "narrow",
  fill = false,
  children,
  footer,
  header = true,
}: {
  /** false hides the top bar entirely (the mobile home uses a footer instead). */
  header?: boolean;
  title?: ReactNode;
  back?: { href: string; label?: string };
  actions?: ReactNode;
  width?: "narrow" | "wide" | "full";
  fill?: boolean;
  children: ReactNode;
  /** Sticky bottom bar (e.g. Send to customer). */
  footer?: ReactNode;
}) {
  const max = width === "full" ? "max-w-none" : width === "wide" ? "max-w-[1200px]" : "max-w-[640px]";
  return (
    <div className={cn("flex flex-col", fill ? "h-dvh" : "min-h-dvh")}>
      {header ? (
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className={cn("mx-auto flex h-14 w-full items-center gap-3 px-4", max)}>
          {back ? (
            <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <Link href={back.href}>
                <ChevronLeft />
                <span className="max-sm:hidden">{back.label ?? "Back"}</span>
              </Link>
            </Button>
          ) : (
            <Brand />
          )}
          {back && title ? <span aria-hidden className="h-5 w-px bg-border" /> : null}
          {title ? (
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
          ) : (
            <div className="flex-1" />
          )}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      ) : null}
      <main className={cn("mx-auto w-full flex-1 px-4", fill ? "min-h-0 py-3" : "py-6", max)}>{children}</main>
      {footer ? (
        <div className="sticky bottom-0 z-10 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className={cn("mx-auto w-full px-4 py-3", max)}>{footer}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Logo mark + wordmark. Links home unless `static`. */
export function Brand({ static: isStatic, suffix }: { static?: boolean; suffix?: ReactNode }) {
  const inner = (
    <>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ScanLine className="size-4" />
      </span>
      <span className="text-sm font-semibold tracking-tight">CarSignal</span>
      {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
    </>
  );
  return isStatic ? (
    <span className="flex items-center gap-2">{inner}</span>
  ) : (
    <Link href="/" className="flex items-center gap-2 rounded-md">
      {inner}
    </Link>
  );
}

/** Section with a small heading, used to group content within a page. */
export function Section({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      {title || actions ? (
        <div className="flex items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-medium text-muted-foreground">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Centered empty / error message with an optional icon. */
export function EmptyState({
  title,
  icon,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="font-medium">{title}</p>
      {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}
