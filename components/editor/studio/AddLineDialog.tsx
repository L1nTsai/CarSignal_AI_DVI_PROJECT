"use client";
/** Studio "Add line": name, rating and note. The clip is marked on the timeline right after. */
import { useState } from "react";
import { Field } from "@/components/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CAR_ZONE_LABEL, guessZone } from "@/lib/carZones";
import { apiSend } from "@/lib/fetcher";
import type { LineRating } from "@/lib/types/db";
import { useAction, useEditor } from "@/components/shared/editor/context";
import { RatingPicker } from "@/components/shared/editor/RatingPicker";

export function AddLineDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (lineId: string) => void;
}) {
  const { data } = useEditor();
  const [name, setName] = useState("");
  const [rating, setRating] = useState<LineRating | null>(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const { run, busy, error } = useAction();

  const zone = guessZone(name);
  const nameErr = tried && name.trim() === "" ? "Give the line a name." : null;
  const ratingErr = tried && !rating ? "Pick a rating." : null;

  const reset = () => {
    setName("");
    setRating(null);
    setNote("");
    setTried(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (name.trim() === "" || !rating) return;
            void run(async () => {
              const res = await apiSend<{ id: string }>(`/api/inspections/${data.inspection.id}/lines`, "POST", {
                component_name: name.trim(),
                rating,
                note,
                car_zone: zone,
              });
              reset();
              onOpenChange(false);
              onAdded(res.id);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Add line</DialogTitle>
            <DialogDescription>
              After adding it, mark the clip&apos;s In and Out on the timeline. A clip is needed before sending.
            </DialogDescription>
          </DialogHeader>
          <Field label="Component" htmlFor="studio-new-line-name" error={nameErr}>
            <Input
              id="studio-new-line-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rear Wiper"
              aria-invalid={!!nameErr || undefined}
            />
            {name.trim() ? (
              <p className="text-xs text-muted-foreground">
                On the customer&apos;s car diagram: {zone ? CAR_ZONE_LABEL[zone] : "not shown"}. You can change it after adding.
              </p>
            ) : null}
          </Field>
          <div className="flex flex-col gap-2">
            <Label asChild>
              <span>Rating</span>
            </Label>
            <RatingPicker value={rating} onChange={setRating} />
            {ratingErr ? <p className="text-sm text-destructive">{ratingErr}</p> : null}
          </div>
          <Field label="Note for the customer" htmlFor="studio-new-line-note" hint="You can also fill this in later.">
            <Textarea id="studio-new-line-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add line"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
