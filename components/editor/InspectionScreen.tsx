"use client";
/**
 * /inspections/[id], driven by status (polled with SWR, ~2 s while anything
 * is in progress):
 *   recording         -> laptop pairing view (QR code + uploaded parts)
 *   processing        -> steps with live progress
 *   failed            -> reason + Retry
 *   ready_for_review / sent -> editor
 */
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { WifiOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Page, StatusBadge } from "@/components/app";
import { PairingView } from "@/components/sharing/PairingView";
import { SendActions } from "@/components/sharing/SendBar";
import { fetcher } from "@/lib/fetcher";
import type { InspectionDetail } from "@/lib/types/api";
import { EditorProvider, type EditorCtx } from "@/components/shared/editor/context";
import { FailedView } from "./FailedView";
import { ProcessingView } from "./ProcessingView";
import { CustomerDialog } from "./studio/CustomerDialog";
import { Studio } from "./studio/Studio";
import { useIsDesktop } from "./useIsDesktop";

const POLL_MS = 2000;

function needsPolling(d: InspectionDetail): boolean {
  const s = d.inspection.status;
  return s === "recording" || s === "processing" || d.lines.some((l) => l.clips.some((c) => c.status === "pending"));
}

function title(d: InspectionDetail | undefined): string {
  const i = d?.inspection;
  if (!i) return "Inspection";
  const vehicle = [i.vehicle_year, i.vehicle_make, i.vehicle_model].filter(Boolean).join(" ");
  return vehicle || i.customer_name || "Untitled inspection";
}

export function InspectionScreen({ id, publicBaseUrl }: { id: string; publicBaseUrl: string }) {
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
  const desktop = useIsDesktop();
  const studio = isEditor && !!data; // the one-screen editor: laptop layout or phone layout

  return (
    <Page
      title={studio && ctx ? <CustomerDialog label={title(data)} ctx={ctx} /> : title(data)}
      back={{ href: "/", label: "Inspections" }}
      width={studio && desktop ? "full" : "narrow"}
      fill={studio}
      actions={
        studio ? (
          <SendActions detail={data!} onSent={() => mutate()} />
        ) : status ? (
          <StatusBadge status={status} />
        ) : null
      }
    >
      {!data ? (
        error ? (
          <EmptyState title={error.status === 404 ? "Inspection not found" : "Couldn't load this inspection"}>
            {error.status === 404 ? "Check the link, or go back to the list." : String(error.message)}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )
      ) : (
        <EditorProvider value={ctx!}>
          {error ? (
            <Alert className="mb-4 border-amber-border bg-amber-bg text-amber-fg">
              <WifiOff />
              <AlertDescription className="text-amber-fg">
                Lost connection. Showing the last loaded version; retrying…
              </AlertDescription>
            </Alert>
          ) : null}
          {status === "processing" ? (
            <ProcessingView data={data} />
          ) : status === "failed" ? (
            <FailedView data={data} />
          ) : studio ? (
            <Studio mobile={!desktop} />
          ) : (
            <PairingView detail={data} publicBaseUrl={publicBaseUrl} />
          )}
        </EditorProvider>
      )}
    </Page>
  );
}
