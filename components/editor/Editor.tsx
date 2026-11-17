"use client";
/**
 * The editor (ready_for_review / sent): details, line cards, add line, and the
 * clip panel. Phone: one column, the clip panel covers the screen. Laptop: line
 * list on the left, clip panel on the right.
 */
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { apiSend } from "@/lib/fetcher";
import { AddLineForm } from "./AddLineForm";
import { ClipPanel, type ClipSelection } from "./ClipPanel";
import { useAction, useEditor } from "./context";
import { DetailsForm } from "./DetailsForm";
import { InlineConfirm } from "./InlineConfirm";
import { LineCard } from "./LineCard";

export function Editor() {
  const { data } = useEditor();
  const [sel, setSel] = useState<{ lineId: string; clip: ClipSelection } | null>(null);
  const move = useAction();
  const reprocess = useAction();

  const selLine = sel ? data.lines.find((l) => l.id === sel.lineId) : undefined;
  const open = !!(sel && selLine);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openClips = (lineId: string, clipId?: string) => {
    const line = data.lines.find((l) => l.id === lineId);
    setSel({ lineId, clip: clipId ?? line?.clips[0]?.id ?? "new" });
  };

  const moveLine = (from: number, to: number) =>
    move.run(() => {
      const ids = data.lines.map((l) => l.id);
      const [id] = ids.splice(from, 1);
      ids.splice(to, 0, id);
      return apiSend(`/api/inspections/${data.inspection.id}/lines/reorder`, "POST", { ids });
    });

  const { inspection, sending, flags } = data;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6">
      <div className="flex flex-col gap-6">
        {inspection.status === "sent" ? (
          <Card className="flex flex-col gap-1 border-blue-border bg-blue-bg p-4 text-blue-fg">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              Sent to the customer{sending.latest_version ? ` (version ${sending.latest_version.version_number})` : ""}
              {sending.unsent_changes ? <Badge tone="amber">Unsent changes</Badge> : null}
            </p>
            <p className="text-sm">The customer sees your edits after you send an update.</p>
          </Card>
        ) : null}

        <DetailsForm />

        <section className="flex flex-col gap-3" aria-label="Lines">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">Lines</h2>
            <span className="text-sm text-muted">{data.lines.length} total</span>
          </div>
          {move.error ? <p className="text-sm text-red-fg">{move.error}</p> : null}
          {data.lines.length === 0 ? (
            <EmptyState title="No lines">Add a line for each part you inspected.</EmptyState>
          ) : (
            <ol className="flex flex-col gap-4">
              {data.lines.map((line, i) => (
                <li key={line.id}>
                  <LineCard
                    line={line}
                    index={i}
                    total={data.lines.length}
                    selected={open && sel?.lineId === line.id}
                    onOpenClips={(clipId) => openClips(line.id, clipId)}
                    onMove={(to) => moveLine(i, to)}
                    moving={move.busy}
                  />
                </li>
              ))}
            </ol>
          )}
          <AddLineForm onAdded={(id) => openClips(id)} />
        </section>

        {flags.enable_reprocess && inspection.status === "ready_for_review" ? (
          <Card className="flex flex-col gap-2 border-dashed p-4">
            <h2 className="text-sm font-medium">Development only</h2>
            <p className="text-sm text-muted">Run the AI again on this recording without recording again.</p>
            <InlineConfirm
              trigger="Re-process"
              triggerVariant="secondary"
              message="This replaces all lines, including your edits."
              confirmLabel="Re-process"
              busy={reprocess.busy}
              onConfirm={() => reprocess.run(() => apiSend(`/api/inspections/${inspection.id}/reprocess`, "POST"))}
            />
            {reprocess.error ? <p className="text-sm text-red-fg">{reprocess.error}</p> : null}
          </Card>
        ) : null}
      </div>

      <aside
        aria-label="Clip editor"
        className={cn(
          open ? "fixed inset-0 z-30 overflow-y-auto bg-background px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]" : "hidden",
          "lg:static lg:z-auto lg:block lg:overflow-visible lg:bg-transparent lg:p-0",
        )}
      >
        <div className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:p-4">
          {open && selLine ? (
            <ClipPanel
              line={selLine}
              selected={sel!.clip}
              onSelect={(clip) => setSel({ lineId: selLine.id, clip })}
              onClose={() => setSel(null)}
            />
          ) : (
            <div className="hidden flex-col items-center gap-2 py-16 text-center lg:flex">
              <p className="font-medium">Clip editor</p>
              <p className="text-sm text-muted">Choose a line&apos;s clips to adjust ranges and photos here.</p>
              {data.lines[0] ? (
                <Button className="mt-2" size="lg" onClick={() => openClips(data.lines[0].id)}>
                  Open first line&apos;s clips
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
