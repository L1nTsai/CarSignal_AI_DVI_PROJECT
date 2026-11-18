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
import { ChevronDown, History } from "lucide-react";
import { Brand } from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LocalDate } from "@/components/shared/LocalDate";
import { ReportMobile } from "@/components/mobile/report/ReportMobile";
import { Responsive } from "@/components/shared/Responsive";
import { ReportViewer } from "@/components/sharing/ReportViewer";
import { getDevice } from "@/lib/device";
import { isShareToken } from "@/lib/http";
import { getShare } from "@/lib/queries/share";
import { RATING_LABEL } from "@/lib/ratings";
import { changeBadges, diffVersions, isEmptyDiff, type LineField, type VersionDiff } from "@/lib/sharing/diff";
import type { ShareLine, ShareResponse } from "@/lib/types/api";

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

  const notice = !isLatest ? (
    <Alert className="border-amber-border bg-amber-bg text-amber-fg">
      <History />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-amber-fg">
        <span>You&apos;re viewing an older version ({version.version_number}).</span>
        <Link href={base} className="font-medium underline">
          See the latest
        </Link>
      </AlertDescription>
    </Alert>
  ) : null;

  const info = (
    <section className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{vehicleName(version)}</h1>
      <p className="text-muted-foreground">For {version.customer_name}</p>
      <p className="text-sm text-muted-foreground">
        Inspected <LocalDate iso={firstSentAt} />
        {" · "}Version {version.version_number}
        {version.version_number > 1 ? (
          <>
            {" · "}Updated <LocalDate iso={version.sent_at} />
          </>
        ) : null}
      </p>
      <p className="mt-1 w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        VIN {version.vin}
      </p>
    </section>
  );

  const hasChanges = !!(diff && previous && !isEmptyDiff(diff));
  const changes = hasChanges ? <ChangesSince previousNumber={previous!.version_number} diff={diff!} /> : null;
  // Same list on the laptop page and in the phone's Versions tab.
  const historyList =
    versions.length > 1 ? (
        <ol className="flex flex-col">
          {[...versions].reverse().map((ver) => {
            const current = ver.version_number === version.version_number;
            const href = ver.version_number === latest_version_number ? base : `${base}?v=${ver.version_number}`;
            return (
              <li key={ver.version_number}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2 text-sm hover:bg-accent aria-[current=page]:font-semibold"
                >
                  <span>
                    Version {ver.version_number}
                    {ver.version_number === latest_version_number ? " (latest)" : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {current ? "Viewing · " : ""}
                    <LocalDate iso={ver.sent_at} withTime />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
    ) : null;
  // Phone: the Versions tab.
  const history = historyList ? (
    <section className="flex w-full flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Version history</h2>
      {historyList}
    </section>
  ) : null;

  // Laptop: everything about the report on one line, with changes and versions as menus.
  const changeCount = hasChanges ? diff!.added.length + diff!.changed.length + diff!.removed.length : 0;
  const infoLine = (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <h1 className="text-lg font-semibold tracking-tight">{vehicleName(version)}</h1>
      <span className="text-muted-foreground">For {version.customer_name}</span>
      <span className="text-muted-foreground">
        Inspected <LocalDate iso={firstSentAt} />
        {version.version_number > 1 ? (
          <>
            {" · "}Updated <LocalDate iso={version.sent_at} />
          </>
        ) : null}
      </span>
      <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">VIN {version.vin}</span>
      <div className="ml-auto flex items-center gap-1.5">
        {hasChanges ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                What changed <span className="text-muted-foreground">{changeCount}</span>
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96">
              <p className="text-sm font-medium">Since version {previous!.version_number}</p>
              <ChangesList diff={diff!} />
            </PopoverContent>
          </Popover>
        ) : null}
        {historyList ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <History />
                Version {version.version_number} of {latest_version_number}
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
              {historyList}
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-muted-foreground">Version {version.version_number}</span>
        )}
      </div>
    </section>
  );

  const badgeRecord = Object.fromEntries(badges);

  return (
    <Responsive
      device={await getDevice()}
      mobile={
        <ReportMobile
          lines={version.lines}
          badges={badgeRecord}
          notice={notice}
          info={info}
          changes={changes ? <ChangesSince previousNumber={previous!.version_number} diff={diff!} open /> : null}
          versions={history}
        />
      }
      desktop={
        // One screen, no page scroll: the issues list scrolls inside its own panel.
        <div className="flex h-dvh flex-col">
          <header className="shrink-0 border-b">
            <div className="mx-auto flex h-12 max-w-[1400px] items-center px-4">
              <Brand static suffix="Vehicle inspection" />
            </div>
          </header>

          <main className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-3 px-4 pt-3 pb-4">
            {notice}
            {infoLine}
            <ReportViewer lines={version.lines} badges={badgeRecord} />
          </main>
        </div>
      }
    />
  );
}

function vehicleName(v: { vehicle_year: number; vehicle_make: string; vehicle_model: string }) {
  return `${v.vehicle_year} ${v.vehicle_make} ${v.vehicle_model}`;
}

const FIELD_TEXT: Record<Exclude<LineField, "rating">, string> = {
  component_name: "renamed",
  note: "note updated",
  clips: "photos and clips updated",
};

function ChangesSince({ previousNumber, diff, open }: { previousNumber: number; diff: VersionDiff<ShareLine>; open?: boolean }) {
  const count = diff.added.length + diff.changed.length + diff.removed.length;
  return (
    <details open={open} className="group w-full max-w-2xl rounded-xl ring-1 ring-foreground/10">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>
          What changed since version {previousNumber}
          <span className="ml-2 font-normal text-muted-foreground">{count}</span>
        </span>
        <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-4 py-3">
        <ChangesList diff={diff} />
      </div>
    </details>
  );
}

function ChangesList({ diff }: { diff: VersionDiff<ShareLine> }) {
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {diff.added.map((l) => (
        <li key={`a-${l.key}`}>
          <span className="font-medium">Added:</span> {l.component_name} ({RATING_LABEL[l.rating]})
        </li>
      ))}
      {diff.changed.map(({ before, after, fields }) => (
        <li key={`c-${after.key}`}>
          <span className="font-medium">Updated:</span> {after.component_name}
          {fields.includes("component_name") ? <span className="text-muted-foreground"> (was {before.component_name})</span> : null}
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
  );
}
