"use client";
/** Failure reason + Retry (POST /api/inspections/[id]/retry). */
import { Button, Card } from "@/components/ui";
import { apiSend } from "@/lib/fetcher";
import type { InspectionDetail } from "@/lib/types/api";
import { useAction } from "./context";

export function FailedView({ data }: { data: InspectionDetail }) {
  const { run, busy, error } = useAction();
  return (
    <Card className="flex flex-col gap-3 border-red-border p-4">
      <div>
        <h2 className="text-base font-semibold text-red-fg">Processing failed</h2>
        <p className="mt-1">{data.inspection.failure_reason ?? "Something went wrong while processing."}</p>
      </div>
      <p className="text-sm text-muted">Retry runs processing again on the same recording.</p>
      <Button
        variant="primary"
        size="lg"
        full
        disabled={busy}
        onClick={() => run(() => apiSend(`/api/inspections/${data.inspection.id}/retry`, "POST"))}
      >
        {busy ? "Starting…" : "Retry"}
      </Button>
      {error ? <p className="text-sm text-red-fg">{error}</p> : null}
    </Card>
  );
}
