"use client";
/** Processing steps with live progress (polled). Safe to close: the worker carries on. */
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
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
      <Card className="p-4">
        <h2 className="text-base font-semibold">Processing your inspection</h2>
        <p className="mt-1 text-sm text-muted">
          You can close this page. Processing keeps going, and the report will be here when you come back.
        </p>
        <ol className="mt-4 flex flex-col">
          {STEPS.map((s, i) => {
            const state: StepState = i < currentIdx ? "done" : i === currentIdx ? "active" : "waiting";
            const d = detail(s.key, state);
            return (
              <li key={s.key} className="flex gap-3 py-2.5" aria-current={state === "active" ? "step" : undefined}>
                <StepIcon state={state} />
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium", state === "waiting" && "text-muted")}>
                    {s.label}
                    <span className="tabular-nums">{count(s.key, state)}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {state === "done" ? "Done" : state === "active" ? "In progress" : "Waiting"}
                    {d ? ` · ${d}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-bg text-sm font-semibold text-green-fg">
        ✓
      </span>
    );
  }
  if (state === "active") {
    return (
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center">
        <span className="size-5 animate-spin rounded-full border-2 border-border border-t-blue-fg" />
      </span>
    );
  }
  return <span aria-hidden className="size-7 shrink-0 rounded-full border-2 border-dashed border-border" />;
}
