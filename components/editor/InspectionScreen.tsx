"use client";
/**
 * /inspections/[id], driven by status (polled with SWR, ~2 s while anything
 * is in progress):
 *   recording         -> pairing view (owned by the pairing agent; placeholder here)
 *   processing        -> steps with live progress
 *   failed            -> reason + Retry
 *   ready_for_review / sent -> editor
 */
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { ButtonLink, EmptyState, Page, StatusBadge } from "@/components/ui";
import { fetcher } from "@/lib/fetcher";
import type { InspectionDetail } from "@/lib/types/api";
import { EditorProvider, type EditorCtx } from "./context";
import { Editor } from "./Editor";
import { FailedView } from "./FailedView";
import { ProcessingView } from "./ProcessingView";

const POLL_MS = 2000;

function needsPolling(d: InspectionDetail): boolean {
  return d.inspection.status === "processing" || d.lines.some((l) => l.clips.some((c) => c.status === "pending"));
}

function title(d: InspectionDetail | undefined): string {
  const i = d?.inspection;
  if (!i) return "Inspection";
  const vehicle = [i.vehicle_year, i.vehicle_make, i.vehicle_model].filter(Boolean).join(" ");
  return vehicle || i.customer_name || "Untitled inspection";
}

export function InspectionScreen({ id }: { id: string }) {
  const [holds, setHolds] = useState(0);
  const key = `/api/inspections/${id}`;
  const { data, error, mutate } = useSWR<InspectionDetail>(key, fetcher, {
    refreshInterval: (d) => ((d && needsPolling(d)) || holds > 0 ? POLL_MS : 0),
    keepPreviousData: true,
  });

  const holdPolling = useCallback(() => {
    setHolds((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setHolds((n) => n - 1);
    };
  }, []);

  const ctx = useMemo<EditorCtx | null>(
    () => (data ? { data, refresh: () => mutate(), holdPolling } : null),
    [data, mutate, holdPolling],
  );

  const status = data?.inspection.status;
  const isEditor = status === "ready_for_review" || status === "sent";

  return (
    <Page
      title={title(data)}
      back={{ href: "/", label: "Inspections" }}
      width={isEditor ? "wide" : "narrow"}
      actions={status ? <StatusBadge status={status} /> : null}
    >
      {!data ? (
        error ? (
          <EmptyState title={error.status === 404 ? "Inspection not found" : "Couldn't load this inspection"}>
            {error.status === 404 ? "Check the link, or go back to the list." : String(error.message)}
          </EmptyState>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )
      ) : (
        <EditorProvider value={ctx!}>
          {error ? (
            <p className="mb-4 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-sm text-amber-fg">
              Lost connection. Showing the last loaded version; retrying…
            </p>
          ) : null}
          {status === "processing" ? (
            <ProcessingView data={data} />
          ) : status === "failed" ? (
            <FailedView data={data} />
          ) : isEditor ? (
            <Editor />
          ) : (
            // TODO(pairing agent): QR pairing view + live list of uploaded parts (plan §10).
            <EmptyState title="Recording in progress">
              <div className="flex flex-col items-center gap-3">
                <p>Record the walkaround, then finish to start processing.</p>
                <ButtonLink href={`/inspections/${id}/record`} variant="primary" size="lg">
                  Record on this device
                </ButtonLink>
              </div>
            </EmptyState>
          )}
        </EditorProvider>
      )}
    </Page>
  );
}
