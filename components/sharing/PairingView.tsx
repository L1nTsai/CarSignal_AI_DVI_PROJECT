"use client";
/**
 * Laptop pairing view for an inspection that is still `recording` (plan §10):
 * a QR code to the recorder on the phone, a "Record on this device" link, and
 * the uploaded parts as they arrive (the page polls InspectionDetail).
 *
 * "Pairing" is just both devices opening the same inspection; nothing is stored.
 */
import { ButtonLink, Card, EmptyState, Section } from "@/components/ui";
import type { InspectionDetail, SegmentDetail } from "@/lib/types/api";
import { QrCode } from "./QrCode";

export function PairingView({ detail, publicBaseUrl }: { detail: InspectionDetail; publicBaseUrl: string }) {
  const id = detail.inspection.id;
  const recordPath = `/inspections/${id}/record`;
  const recordUrl = `${publicBaseUrl}${recordPath}`;
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(publicBaseUrl);
  const parts = detail.segments;

  return (
    <div className="flex flex-col gap-8">
      <Card className="flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:items-start sm:text-left">
        <QrCode value={recordUrl} size={208} className="shrink-0" />
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Record on your phone</h2>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-left text-sm text-muted">
            <li>Scan this code with the phone&apos;s camera.</li>
            <li>Record the walkaround. Each part shows up here once it&apos;s uploaded.</li>
            <li>Tap Finish on the phone when you&apos;re done.</li>
          </ol>
          <p className="font-mono text-xs break-all text-subtle">{recordUrl}</p>
          {isLocalhost ? (
            <p className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-sm text-amber-fg">
              This code points to localhost, which a phone can&apos;t open. Set PUBLIC_BASE_URL to your tunnel URL
              and restart.
            </p>
          ) : null}
          <div>
            <ButtonLink href={recordPath} variant="secondary">
              Record on this device
            </ButtonLink>
          </div>
        </div>
      </Card>

      <Section title={parts.length ? `Uploaded parts (${parts.length})` : "Uploaded parts"}>
        {parts.length === 0 ? (
          <EmptyState title="Nothing recorded yet">Parts appear here as the phone uploads them.</EmptyState>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {parts.map((s) => (
              <li key={s.id}>
                <PartTile part={s} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function PartTile({ part }: { part: SegmentDetail }) {
  return (
    <Card className="overflow-hidden">
      {part.status === "uploaded" ? (
        <video src={part.url} controls playsInline preload="metadata" className="block aspect-video w-full" />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-surface text-sm text-muted">
          {part.status === "uploading" ? "Uploading…" : "Upload failed"}
        </div>
      )}
      <p className="px-3 py-2 text-sm">Part {part.segment_number}</p>
    </Card>
  );
}
