"use client";
/** One editable line: name, rating, note, photo, quotes, warnings, clips row, reorder and delete. */
import { Button, Card, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/editor/clipRange";
import { apiSend } from "@/lib/fetcher";
import { unsupportedNumbers } from "@/lib/ai/grounding";
import type { LineDetail } from "@/lib/types/api";
import type { LineRating } from "@/lib/types/db";
import { ClipStatus } from "./ClipPanel";
import { useAction, useEditor } from "./context";
import { InlineConfirm } from "./InlineConfirm";
import { RatingPicker } from "./RatingPicker";
import { saveHint, useBlurSave } from "./useBlurSave";

function lineWarnings(line: LineDetail): string[] {
  const out: string[] = [];
  if (line.source === "ai") {
    const nums = unsupportedNumbers(
      line.note,
      line.mentions.map((m) => m.quote),
    );
    if (nums.length) {
      const list = nums.length === 1 ? nums[0] : `${nums.slice(0, -1).join(", ")} and ${nums.at(-1)}`;
      out.push(`The note mentions ${list}, but you didn't say that.`);
    }
    const ai = line.ai_suggestion;
    if (ai?.rating_basis === "inferred" && line.rating === ai.rating) {
      out.push("You didn't say a rating out loud; the AI guessed it from your words. Check it.");
    }
  }
  for (const c of line.clips) {
    if (c.status === "failed") out.push(`Clip ${c.position} couldn't be cut. Open the clips to retry.`);
  }
  if (line.clips.length === 0) out.push("No clips yet. Every line needs one before sending.");
  if (line.note.trim() === "") out.push("Add a note before sending.");
  return out;
}

export function LineCard({
  line,
  index,
  total,
  selected,
  onOpenClips,
  onMove,
  moving,
}: {
  line: LineDetail;
  index: number;
  total: number;
  selected: boolean;
  onOpenClips: (clipId?: string) => void;
  onMove: (to: number) => void;
  moving: boolean;
}) {
  const { refresh } = useEditor();
  const patch = async (body: Partial<{ component_name: string; note: string; rating: LineRating }>) => {
    await apiSend(`/api/lines/${line.id}`, "PATCH", body);
    await refresh();
  };
  const name = useBlurSave(line.component_name, (v) => patch({ component_name: v.trim() }), {
    validate: (v) => (v.trim() === "" ? "The name can't be empty." : null),
  });
  const note = useBlurSave(line.note, (v) => patch({ note: v }));
  const rating = useAction();
  const del = useAction();

  const warnings = lineWarnings({ ...line, note: note.value });
  const nameHint = saveHint(name.state, name.error);
  const noteHint = saveHint(note.state, note.error);

  return (
    <Card className={cn("flex flex-col gap-4 p-4", selected && "border-2 border-foreground")}>
      <div className="flex items-start gap-3">
        <span className="mt-3 flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-bg text-xs font-semibold text-gray-fg">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`name-${line.id}`} className="sr-only">
            Component name
          </label>
          <Input
            id={`name-${line.id}`}
            value={name.value}
            onChange={(e) => name.onChange(e.target.value)}
            onBlur={name.onBlur}
            aria-invalid={name.state === "error" || undefined}
            className="font-semibold"
          />
          {nameHint ? (
            <p className={cn("text-xs", name.state === "error" ? "text-red-fg" : "text-muted")}>{nameHint}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <RatingPicker
          value={line.rating}
          disabled={rating.busy}
          onChange={(r) => rating.run(() => apiSend(`/api/lines/${line.id}`, "PATCH", { rating: r }))}
        />
        {rating.error ? <p className="text-xs text-red-fg">{rating.error}</p> : null}
        {line.ai_suggestion && line.rating !== line.ai_suggestion.rating ? (
          <p className="text-xs text-muted">Changed from the AI&apos;s suggestion.</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`note-${line.id}`} className="text-sm font-medium">
          Note for the customer
        </label>
        <Textarea
          id={`note-${line.id}`}
          value={note.value}
          onChange={(e) => note.onChange(e.target.value)}
          onBlur={note.onBlur}
          rows={3}
          placeholder="What you observed, in plain words"
        />
        {noteHint ? (
          <p className={cn("text-xs", note.state === "error" ? "text-red-fg" : "text-muted")}>{noteHint}</p>
        ) : null}
      </div>

      {warnings.length ? (
        <ul className="flex flex-col gap-1.5">
          {warnings.map((w) => (
            <li
              key={w}
              className="flex gap-2 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-sm text-amber-fg"
            >
              <span aria-hidden className="font-semibold">
                !
              </span>
              <span>
                <span className="sr-only">Warning: </span>
                {w}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {line.photo_url ? (
        <button type="button" onClick={() => onOpenClips(line.clips[0]?.id)} className="block" aria-label="Edit the main clip">
          {/* eslint-disable-next-line @next/next/no-img-element -- proxied media, sizes unknown */}
          <img src={line.photo_url} alt={`${line.component_name} photo`} className="media max-h-72 w-full rounded-md" />
        </button>
      ) : (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">
          No photo yet
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            Clips <span className="text-muted">({line.clips.length})</span>
          </h3>
          <Button size="lg" onClick={() => onOpenClips()}>
            {line.clips.length ? "Edit clips" : "Add a clip"}
          </Button>
        </div>
        {line.clips.length ? (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {line.clips.map((c) => (
              <li key={c.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenClips(c.id)}
                  className="flex w-36 flex-col gap-1 rounded-md border border-border p-1 text-left hover:bg-surface-hover"
                >
                  {c.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- proxied media
                    <img src={c.thumbnail_url} alt="" className="media h-20 w-full rounded-sm" />
                  ) : (
                    <span className="flex h-20 w-full items-center justify-center rounded-sm bg-surface text-xs text-muted">
                      No photo
                    </span>
                  )}
                  <span className="flex items-center justify-between gap-1 px-0.5 text-xs">
                    <span className="font-medium">
                      Clip {c.position}
                      {c.position === 1 ? " · Main" : ""}
                    </span>
                    <span className="text-muted tabular-nums">{((c.end_ms - c.start_ms) / 1000).toFixed(0)}s</span>
                  </span>
                  <span className="px-0.5">
                    <ClipStatus clip={c} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {line.mentions.length ? (
        <details className="group rounded-md border border-border">
          <summary className="flex min-h-12 cursor-pointer items-center justify-between px-3 text-sm font-medium">
            What you said ({line.mentions.length})
            <span className="text-xs font-normal text-muted">Only you see this</span>
          </summary>
          <ul className="flex flex-col gap-2 border-t border-border p-3">
            {line.mentions.map((m) => (
              <li key={m.id} className="text-sm">
                <span className="mr-2 text-xs text-muted tabular-nums">{formatMs(m.visible_start_ms)}</span>
                <q className="italic">{m.quote}</q>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="lg" aria-label="Move line up" disabled={index === 0 || moving} onClick={() => onMove(index - 1)}>
          ↑ Up
        </Button>
        <Button
          size="lg"
          aria-label="Move line down"
          disabled={index === total - 1 || moving}
          onClick={() => onMove(index + 1)}
        >
          ↓ Down
        </Button>
        <div className="ml-auto has-[[role=alertdialog]]:ml-0 has-[[role=alertdialog]]:basis-full">
          <InlineConfirm
            trigger="Delete line"
            message={`Delete “${line.component_name}” and its clips?`}
            confirmLabel="Delete line"
            busy={del.busy}
            onConfirm={() => del.run(() => apiSend(`/api/lines/${line.id}`, "DELETE"))}
          />
        </div>
      </div>
      {del.error ? <p className="text-sm text-red-fg">{del.error}</p> : null}
    </Card>
  );
}
