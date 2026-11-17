/**
 * /r/[token] — the customer's read-only report (plan §10). Latest version by
 * default; ?v=N shows an older one.
 *
 * Rendered on the server from getShare(), the same builder as
 * GET /api/share/[token]. ShareResponse carries no ids, quotes, AI originals
 * or storage paths, so nothing here can leak edit access. This page also has
 * no link to the tech side ("/").
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Badge, RATING_TONE } from "@/components/ui";
import { LocalDate } from "@/components/sharing/LocalDate";
import { ReportLineCard } from "@/components/sharing/ReportLineCard";
import { isShareToken } from "@/lib/http";
import { getShare } from "@/lib/queries/share";
import { RATING_LABEL, RATING_ORDER, groupByRating } from "@/lib/ratings";
import { changeBadges, diffVersions, isEmptyDiff, type LineField, type VersionDiff } from "@/lib/sharing/diff";
import type { ShareLine, ShareResponse } from "@/lib/types/api";
import type { LineRating } from "@/lib/types/db";

const load = cache(async (token: string, v: string | string[] | undefined): Promise<ShareResponse | null> => {
  if (!isShareToken(token)) return null;
  let version: number | undefined;
  if (typeof v === "string" && v !== "") {
    version = Number(v);
    if (!Number.isInteger(version) || version < 1) return null;
  }
  return getShare(token, version);
});

export async function generateMetadata(props: PageProps<"/r/[token]">): Promise<Metadata> {
  const { token } = await props.params;
  const { v } = await props.searchParams;
  const data = await load(token, v);
  return {
    title: data ? `${vehicleName(data.version)} inspection` : "Inspection report",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function CustomerReportPage(props: PageProps<"/r/[token]">) {
  const { token } = await props.params;
  const { v } = await props.searchParams;
  const data = await load(token, v);
  if (!data) notFound();

  const { version, previous, versions, latest_version_number } = data;
  const isLatest = version.version_number === latest_version_number;
  const diff = previous ? diffVersions(previous.lines, version.lines) : null;
  const badges = diff ? changeBadges(diff) : new Map();
  const firstSentAt = versions[0]?.sent_at ?? version.sent_at;
  const base = `/r/${encodeURIComponent(token)}`;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-[640px] items-center px-4">
          <span className="text-sm font-semibold tracking-tight">CarSignal</span>
          <span className="ml-2 text-sm text-muted">Vehicle inspection</span>
        </div>
      </header>

      <main className="mx-auto flex max-w-[640px] flex-col gap-8 px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {!isLatest ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-border bg-amber-bg px-4 py-3 text-sm text-amber-fg">
            <span>You&apos;re viewing an older version ({version.version_number}).</span>
            <Link href={base} className="font-medium underline">
              See the latest
            </Link>
          </div>
        ) : null}

        <section className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{vehicleName(version)}</h1>
          <p className="text-muted">For {version.customer_name}</p>
          <p className="text-sm text-muted">
            Inspected <LocalDate iso={firstSentAt} />
            {" · "}Version {version.version_number}
            {version.version_number > 1 ? (
              <>
                {" · "}Updated <LocalDate iso={version.sent_at} />
              </>
            ) : null}
          </p>
          <p className="font-mono text-xs text-subtle">VIN {version.vin}</p>
        </section>

        <Summary lines={version.lines} />

        {diff && previous && !isEmptyDiff(diff) ? <ChangesSince previousNumber={previous.version_number} diff={diff} /> : null}

        {groupByRating(version.lines).map((group) => (
          <section key={group.rating} className="flex flex-col gap-3" aria-labelledby={`sec-${group.rating}`}>
            <h2 id={`sec-${group.rating}`} className="flex items-center gap-2 text-lg font-semibold">
              {RATING_LABEL[group.rating]}
              <span className="text-sm font-normal text-muted">{group.lines.length}</span>
            </h2>
            <ul className="flex flex-col gap-4">
              {group.lines.map((line) => (
                <li key={line.key}>
                  <ReportLineCard line={line} badge={badges.get(line.key) ?? null} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {versions.length > 1 ? (
          <section className="flex flex-col gap-2 border-t border-border pt-6">
            <h2 className="text-sm font-medium text-muted">Version history</h2>
            <ol className="flex flex-col">
              {[...versions].reverse().map((ver) => {
                const current = ver.version_number === version.version_number;
                const href = ver.version_number === latest_version_number ? base : `${base}?v=${ver.version_number}`;
                return (
                  <li key={ver.version_number}>
                    <Link
                      href={href}
                      aria-current={current ? "page" : undefined}
                      className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2 text-sm hover:bg-surface-hover aria-[current=page]:font-semibold"
                    >
                      <span>
                        Version {ver.version_number}
                        {ver.version_number === latest_version_number ? " (latest)" : ""}
                      </span>
                      <span className="text-muted">
                        {current ? "Viewing · " : ""}
                        <LocalDate iso={ver.sent_at} withTime />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function vehicleName(v: { vehicle_year: number; vehicle_make: string; vehicle_model: string }) {
  return `${v.vehicle_year} ${v.vehicle_make} ${v.vehicle_model}`;
}

const SUMMARY_LABEL: Record<LineRating, (n: number) => string> = {
  needs_attention: (n) => `${n} need${n === 1 ? "s" : ""} attention`,
  monitor: (n) => `${n} to monitor`,
  good: (n) => `${n} good`,
};

/** e.g. "2 need attention · 1 to monitor · 5 good", as text + color pills. */
function Summary({ lines }: { lines: ShareLine[] }) {
  const counts = RATING_ORDER.map((r) => [r, lines.filter((l) => l.rating === r).length] as const).filter(([, n]) => n > 0);
  return (
    <section aria-label="Summary" className="flex flex-wrap gap-2">
      {counts.map(([rating, n]) => (
        <Badge key={rating} tone={RATING_TONE[rating]} size="md">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {SUMMARY_LABEL[rating](n)}
        </Badge>
      ))}
    </section>
  );
}

const FIELD_TEXT: Record<Exclude<LineField, "rating">, string> = {
  component_name: "renamed",
  note: "note updated",
  clips: "photos and clips updated",
};

function ChangesSince({ previousNumber, diff }: { previousNumber: number; diff: VersionDiff<ShareLine> }) {
  const count = diff.added.length + diff.changed.length + diff.removed.length;
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>
          What changed since version {previousNumber}
          <span className="ml-2 font-normal text-muted">{count}</span>
        </span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm">
        {diff.added.map((l) => (
          <li key={`a-${l.key}`}>
            <span className="font-medium">Added:</span> {l.component_name} ({RATING_LABEL[l.rating]})
          </li>
        ))}
        {diff.changed.map(({ before, after, fields }) => (
          <li key={`c-${after.key}`}>
            <span className="font-medium">Updated:</span> {after.component_name}
            {fields.includes("component_name") ? <span className="text-muted"> (was {before.component_name})</span> : null}
            {" — "}
            {fields
              .map((f) =>
                f === "rating" ? `${RATING_LABEL[before.rating]} → ${RATING_LABEL[after.rating]}` : FIELD_TEXT[f],
              )
              .join(", ")}
          </li>
        ))}
        {diff.removed.map((l) => (
          <li key={`r-${l.key}`}>
            <span className="font-medium">Removed:</span> {l.component_name}
          </li>
        ))}
      </ul>
    </details>
  );
}
