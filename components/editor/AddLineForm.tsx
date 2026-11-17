"use client";
/** Add a tech line: name, rating, note, then choose a clip range (a clip is needed before sending). */
import { useState } from "react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { rangeError } from "@/lib/editor/clipRange";
import { apiSend } from "@/lib/fetcher";
import type { LineRating } from "@/lib/types/db";
import { useAction, useEditor } from "./context";
import { RangeEditor, type Range } from "./RangeEditor";
import { RatingPicker } from "./RatingPicker";

export function AddLineForm({ onAdded }: { onAdded: (lineId: string) => void }) {
  const { data } = useEditor();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rating, setRating] = useState<LineRating | null>(null);
  const [note, setNote] = useState("");
  const [range, setRange] = useState<Range>({ start: null, end: null });
  const [tried, setTried] = useState(false);
  const { run, busy, error } = useAction();

  const duration = data.inspection.duration_ms ?? 0;
  const hasRange = range.start !== null && range.end !== null;
  const rangeErr = hasRange ? rangeError(range.start!, range.end!, duration) : null;

  const reset = () => {
    setName("");
    setRating(null);
    setNote("");
    setRange({ start: null, end: null });
    setTried(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <Button size="lg" full onClick={() => setOpen(true)} className="border-dashed">
        + Add line
      </Button>
    );
  }

  const nameErr = tried && name.trim() === "" ? "Give the line a name." : null;
  const ratingErr = tried && !rating ? "Pick a rating." : null;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-base font-semibold">New line</h2>
      <Field label="Component" htmlFor="new-line-name" error={nameErr}>
        <Input
          id="new-line-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Rear Wiper"
          aria-invalid={!!nameErr || undefined}
          autoFocus
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Rating</span>
        <RatingPicker value={rating} onChange={setRating} />
        {ratingErr ? <p className="text-sm text-red-fg">{ratingErr}</p> : null}
      </div>
      <Field label="Note for the customer" htmlFor="new-line-note" hint="You can also fill this in later.">
        <Textarea id="new-line-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Clip</span>
        <p className="text-sm text-muted">
          Find the part in the video and set the start and end. A clip is needed before sending; you can add it later
          from the line.
        </p>
        {data.video_url ? (
          <RangeEditor
            videoUrl={data.video_url}
            durationMs={duration}
            pausePointsMs={data.pause_points_ms}
            value={range}
            onChange={setRange}
          />
        ) : (
          <p className="text-sm text-muted">The video isn&apos;t available.</p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          size="lg"
          className="sm:flex-1"
          disabled={busy || !!rangeErr}
          onClick={() => {
            setTried(true);
            if (name.trim() === "" || !rating) return;
            void run(async () => {
              const res = await apiSend<{ id: string }>(`/api/inspections/${data.inspection.id}/lines`, "POST", {
                component_name: name.trim(),
                rating,
                note,
                ...(hasRange ? { clip: { start_ms: range.start, end_ms: range.end } } : {}),
              });
              reset();
              onAdded(res.id);
            });
          }}
        >
          {busy ? "Adding…" : hasRange ? "Add line with clip" : "Add line without clip"}
        </Button>
        <Button size="lg" onClick={reset} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error ? <p className="text-sm text-red-fg">{error}</p> : null}
    </Card>
  );
}
