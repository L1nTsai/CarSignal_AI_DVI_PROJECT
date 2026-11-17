/** /inspections/[id]/record — the phone recorder (plan §6). */
import { notFound } from "next/navigation";
import { Recorder } from "@/components/recorder/Recorder";
import { ButtonLink, EmptyState, Page } from "@/components/ui";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { isUuid } from "@/lib/http";
import { mediaUrl } from "@/lib/media";
import type { InspectionStatus, VideoSegmentRow } from "@/lib/types/db";

export const metadata = { title: "Record inspection" };

export default async function RecordPage({ params }: PageProps<"/inspections/[id]/record">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [insp] = await sql<{ status: InspectionStatus }[]>`select status from inspections where id = ${id}`;
  if (!insp) notFound();

  if (insp.status !== "recording") {
    return (
      <Page title="Record inspection" back={{ href: `/inspections/${id}`, label: "Inspection" }}>
        <EmptyState title="Recording is finished">
          <p>Nothing more can be added to this inspection.</p>
          <ButtonLink href={`/inspections/${id}`} variant="primary" className="mt-4">
            Open inspection
          </ButtonLink>
        </EmptyState>
      </Page>
    );
  }

  const segments = await sql<Pick<VideoSegmentRow, "segment_number" | "status" | "original_path" | "mime_type">[]>`
    select segment_number, status, original_path, mime_type
    from video_segments where inspection_id = ${id} order by segment_number`;

  return (
    <Recorder
      inspectionId={id}
      maxMs={env().MAX_RECORDING_MS}
      initialSegments={segments.map((s) => ({
        n: s.segment_number,
        status: s.status,
        url: mediaUrl(s.original_path),
        mimeType: s.mime_type,
      }))}
    />
  );
}
