"use client";
/** Client side of /inspections/[id]. See page.tsx for who owns what. */
import useSWR from "swr";
import { Card, EmptyState, Page, RatingBadge, StatusBadge } from "@/components/ui";
import { PairingView } from "@/components/sharing/PairingView";
import { SendBar } from "@/components/sharing/SendBar";
import { fetcher } from "@/lib/fetcher";
import { PROCESSING_STEP_LABEL } from "@/lib/ratings";
import type { InspectionDetail } from "@/lib/types/api";

export function InspectionView({ id, publicBaseUrl }: { id: string; publicBaseUrl: string }) {
  const { data, error, mutate } = useSWR<InspectionDetail>(`/api/inspections/${id}`, fetcher, {
    // Poll while something is in progress (recording parts arriving, processing).
    refreshInterval: (d) => (!d || d.inspection.status === "recording" || d.inspection.status === "processing" ? 2000 : 0),
  });

  if (error) {
    return (
      <Page back={{ href: "/", label: "Inspections" }}>
        <EmptyState title={error.status === 404 ? "Inspection not found" : "Couldn't load the inspection"}>
          {error.status === 404 ? null : error.message}
        </EmptyState>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page back={{ href: "/", label: "Inspections" }}>
        <p className="text-sm text-muted">Loading…</p>
      </Page>
    );
  }

  const { inspection: insp } = data;
  const title = insp.vehicle_make
    ? `${insp.vehicle_year ?? ""} ${insp.vehicle_make} ${insp.vehicle_model ?? ""}`.trim()
    : "Untitled inspection";
  const canSend = insp.status === "ready_for_review" || insp.status === "sent";

  return (
    <Page
      back={{ href: "/", label: "Inspections" }}
      title={title}
      actions={<StatusBadge status={insp.status} />}
      footer={canSend ? <SendBar detail={data} onSent={() => mutate()} /> : undefined}
    >
      {insp.status === "recording" ? (
        <PairingView detail={data} publicBaseUrl={publicBaseUrl} />
      ) : insp.status === "processing" ? (
        // PLACEHOLDER (editor agent): processing steps with live progress.
        <EmptyState title="Processing">
          {insp.processing_step ? PROCESSING_STEP_LABEL[insp.processing_step] : "Working"}…
        </EmptyState>
      ) : insp.status === "failed" ? (
        // PLACEHOLDER (editor agent): failure reason + Retry.
        <EmptyState title="Processing failed">{insp.failure_reason}</EmptyState>
      ) : (
        // PLACEHOLDER (editor agent): the editor. Read-only list for now.
        <ul className="flex flex-col gap-3">
          {data.lines.map((l) => (
            <li key={l.id}>
              <Card className="flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{l.component_name}</p>
                  <RatingBadge rating={l.rating} />
                </div>
                <p className="text-sm text-muted">{l.note || "No note yet"}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
