/** /inspections/[id]/record — the phone recorder (plan §6). */
import { notFound } from "next/navigation";
import { Recorder } from "@/components/mobile/record/Recorder";
import { EmptyState, Page } from "@/components/app";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
          <Button asChild className="mt-4">
            <Link href={`/inspections/${id}`}>Open inspection</Link>
          </Button>
        </EmptyState>
      </Page>
    );
  }

  const segments = await sql<Pick<VideoSegmentRow, "segment_number" | "status" | "original_path" | "mime_type" | "video_cut_at_ms">[]>`
    select segment_number, status, original_path, mime_type, video_cut_at_ms
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
        videoCutAtMs: s.video_cut_at_ms,
      }))}
    />
  );
}
