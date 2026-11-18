"use client";
/**
 * Processing steps with live progress (polled). Safe to close: the worker carries on.
 * Cancel (converting / AI review only) sends the inspection back to a draft (its parts are
 * kept) and returns to the home list. It is not a failure.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { apiSend } from "@/lib/fetcher";
import { canCancelProcessing } from "@/lib/processing";
import type { InspectionDetail } from "@/lib/types/api";
import type { ProcessingStep } from "@/lib/types/db";

type StepState = "done" | "active" | "waiting";
const STEPS: { key: "uploading" | ProcessingStep; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "converting", label: "Converting" },
  { key: "analyzing", label: "AI reviewing" },
  { key: "cutting", label: "Cutting clips" },
];

export function ProcessingView({ data }: { data: InspectionDetail }) {
  const { inspection, progress } = data;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  /** Cancel, then home: the inspection is now a draft in the list. */
  async function cancelToDraft() {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/inspections/${inspection.id}/cancel`, "POST");
      router.replace("/");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const uploadsDone = progress.segments_total > 0 && progress.segments_uploaded === progress.segments_total;
  const current = inspection.processing_step;
  const currentIdx = uploadsDone ? STEPS.findIndex((s) => s.key === current) : 0;

  const cutDone = progress.clips_ready + progress.clips_failed;
  /** Count shown next to the label, e.g. "Cutting clips 3/6". */
  const count = (key: string, state: StepState) =>
    key === "cutting" && state !== "waiting" && progress.clips_total > 0 ? ` ${cutDone}/${progress.clips_total}` : "";
  const detail = (key: string, state: StepState): string | null => {
    if (key === "uploading") {
      return `${progress.segments_uploaded} of ${progress.segments_total} part${progress.segments_total === 1 ? "" : "s"} uploaded`;
    }
    if (key === "analyzing" && state === "active") return "Finding each part you talked about. This can take a minute.";
    if (key === "cutting" && progress.clips_failed) return `${progress.clips_failed} couldn't be cut; you can retry them in the editor`;
    return null;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Processing your inspection</CardTitle>
          <CardDescription>
            You can close this page. Processing keeps going, and the report will be here when you come back.
          </CardDescription>
        </CardHeader>
        <CardContent>
        <ol className="flex flex-col">
          {STEPS.map((s, i) => {
            const state: StepState = i < currentIdx ? "done" : i === currentIdx ? "active" : "waiting";
            const d = detail(s.key, state);
            return (
              <li key={s.key} className="relative flex gap-3 py-2.5 not-last:after:absolute not-last:after:top-10 not-last:after:bottom-0 not-last:after:left-3.5 not-last:after:w-px not-last:after:bg-border" aria-current={state === "active" ? "step" : undefined}>
                <StepIcon state={state} />
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium", state === "waiting" && "text-muted-foreground")}>
                    {s.label}
                    <span className="tabular-nums">{count(s.key, state)}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {state === "done" ? "Done" : state === "active" ? "In progress" : "Waiting"}
                    {d ? ` · ${d}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        </CardContent>
      </Card>
      {canCancelProcessing(inspection.processing_step) ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          trigger={
            <Button variant="outline" size="lg" className="w-full">
              <X />
              Cancel processing
            </Button>
          }
          title="Cancel processing?"
          description={
            inspection.processing_step === "analyzing"
              ? "The AI review stops and the result is discarded. The inspection is saved as a draft with its recording, so you can finish it again later."
              : "Processing stops. The inspection is saved as a draft with its recording, so you can finish it again later."
          }
          confirmLabel="Cancel processing"
          cancelLabel="Keep processing"
          busy={busy}
          error={error}
          onConfirm={cancelToDraft}
        />
      ) : null}
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-bg text-green-fg">
        <Check className="size-4" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-bg text-blue-fg">
        <Loader2 className="size-4 animate-spin" />
      </span>
    );
  }
  return <span aria-hidden className="size-7 shrink-0 rounded-full border-2 border-dashed bg-background" />;
}
