"use client";
/**
 * Customer report on a phone: one screen, no page scroll.
 *
 *   ┌────────────────────┐
 *   │ vehicle · customer │
 *   │ video (always)     │
 *   │ ‹ issue · clip n › │
 *   ├────────────────────┤
 *   │ one of:            │   Issues: the car diagram + one card for the playing issue
 *   │  Issues            │   Changes: what changed since the last version
 *   │  Changes           │   Versions: version history
 *   │  Versions          │   Info: customer, vehicle, VIN, dates
 *   │  Info              │
 *   ├────────────────────┤
 *   │ bottom tab bar     │
 *   └────────────────────┘
 *
 * The server builds the Changes / Versions / Info content (it needs dates and
 * links) and passes it in. Customer-facing: ShareLine fields only.
 */
import { useState, type ReactNode } from "react";
import { GitCompareArrows, History, Info, ListChecks } from "lucide-react";
import { Brand } from "@/components/app";
import { IssuePanel, PlayerPane, useReportPlayer } from "@/components/sharing/ReportViewer";
import { cn } from "@/lib/cn";
import type { LineChangeBadge } from "@/lib/sharing/diff";
import type { ShareLine } from "@/lib/types/api";

type Tab = "issues" | "changes" | "versions" | "info";

export function ReportMobile({
  lines,
  badges,
  notice,
  info,
  changes,
  versions,
}: {
  lines: ShareLine[];
  badges: Record<string, LineChangeBadge>;
  /** "You're viewing an older version", when it applies. */
  notice: ReactNode;
  info: ReactNode;
  /** null when there's nothing to show (first version, or no differences). */
  changes: ReactNode | null;
  /** null when there's only one version. */
  versions: ReactNode | null;
}) {
  const [tab, setTab] = useState<Tab>("issues");
  const r = useReportPlayer(lines);

  const tabs: { id: Tab; label: string; icon: typeof Info; show: boolean }[] = [
    { id: "issues", label: "Issues", icon: ListChecks, show: true },
    { id: "changes", label: "Changes", icon: GitCompareArrows, show: changes !== null },
    { id: "versions", label: "Versions", icon: History, show: versions !== null },
    { id: "info", label: "Info", icon: Info, show: true },
  ];
  const shown = tabs.filter((t) => t.show);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 shrink-0 items-center border-b px-4">
        <Brand static suffix="Vehicle inspection" />
      </header>

      {/* The video is always here; only the panel under it changes. */}
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-2">
        {notice}
        <PlayerPane r={r} videoClass="max-h-[30dvh]" />
      </div>

      {/* Issues: the car and the one card fit the space above the tab bar (a long note scrolls inside the
          card area, never under the bar). Other tabs scroll here. */}
      <main
        className={cn(
          "flex min-h-0 flex-1 flex-col border-t px-3 py-2",
          tab === "issues" ? "overflow-hidden" : "overflow-y-auto overscroll-contain",
        )}
      >
        {tab === "issues" ? <IssuePanel r={r} badges={badges} compact single /> : null}
        {tab === "changes" ? changes : null}
        {tab === "versions" ? versions : null}
        {tab === "info" ? info : null}
      </main>

      <nav
        aria-label="Report sections"
        className="grid shrink-0 gap-0.5 border-t bg-background p-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))]"
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
      >
        {shown.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
            className={cn(
              "flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium transition-colors",
              tab === id ? "bg-muted text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
