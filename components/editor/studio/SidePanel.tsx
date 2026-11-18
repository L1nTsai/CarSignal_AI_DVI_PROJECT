"use client";
/**
 * Studio side panel. Tabs: Details (one scrolling column, below),
 * Thumbnail (the selected clip's photo picker) and Transcript.
 *   1. Customer and vehicle
 *   2. The selected issue: name, rating, note, warnings, order, delete
 *   (The selected clip's range, delete and drawings live outside the panel:
 *    the laptop's ClipBar under the video, the phone's Timeline tab.)
 *   3. Transcript: everything the tech said, in time order (click to jump)
 */
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Brush,
  Check,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { ConfirmDialog } from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/editor/clipRange";
import { apiSend } from "@/lib/fetcher";
import type { ClipDetail, LineDetail } from "@/lib/types/api";
import type { LineRating } from "@/lib/types/db";
import { useAction, useEditor } from "@/components/shared/editor/context";
import { DetailsForm } from "@/components/shared/editor/DetailsForm";
import { lineWarnings } from "@/components/shared/editor/lineWarnings";
import { RatingPicker } from "@/components/shared/editor/RatingPicker";
import { saveHint, useBlurSave } from "@/components/shared/editor/useBlurSave";
import { insideClip } from "@/lib/annotations";
import { CAR_ZONE_LABEL, type CarZone } from "@/lib/carZones";
import { CarDiagram } from "@/components/shared/CarDiagram";
import { deleteAnnotation } from "@/components/shared/annotations/useDrawSession";
import type { Player } from "./usePlayer";
import { clipNumber, clipsByTime, type Range, type Selection } from "./types";

export function SidePanel({
  selection,
  line,
  clip,
  player,
  onSelectClip,
  onBeginNewClip,
  tab: controlledTab,
  hideTabs = false,
  hideVehicle = false,
  transcriptWindow = null,
}: {
  /** Show this tab instead of keeping its own (the phone layout switches tabs from a bottom bar). */
  tab?: "details" | "thumbnail" | "transcript";
  hideTabs?: boolean;
  /** Leave the customer/vehicle form out of Details (the phone edits it from the header). */
  hideVehicle?: boolean;
  /** Transcript tab: show only what was said in this time span (with a switch for the whole recording). */
  transcriptWindow?: Range | null;
  selection: Selection | null;
  line: LineDetail | undefined;
  clip: ClipDetail | undefined;
  player: Player;
  onSelectClip: (lineId: string, clipId: string | "new" | null) => void;
  onBeginNewClip: (lineId: string) => void;
}) {
  const [ownTab, setTab] = useState<"details" | "thumbnail" | "transcript">("details");
  const tab = controlledTab ?? ownTab;
  const { data } = useEditor();
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as "details" | "thumbnail" | "transcript")}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className={cn("shrink-0 border-b px-3 pt-2", hideTabs && "hidden")}>
        <TabsList variant="line" className="w-full">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="thumbnail">Thumbnail</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="thumbnail" className="min-h-0 flex-1 overflow-y-auto">
        <Panel>
          {line && clip ? (
            <>
              {hideTabs ? (
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Clips">
                  {clipsByTime(line).map((c, i) => (
                    <Button
                      key={c.id}
                      size="sm"
                      role="tab"
                      aria-selected={c.id === clip.id}
                      variant={c.id === clip.id ? "default" : "outline"}
                      onClick={() => onSelectClip(line.id, c.id)}
                    >
                      Clip {i + 1}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">{line.component_name}</p>
                  <h2 className="text-base font-semibold">Clip {clipNumber(line, clip.id)}</h2>
                </div>
              )}
              <PhotoSection key={clip.id} clip={clip} player={player} />
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Pick a clip below the video to choose its thumbnail.
            </p>
          )}
        </Panel>
      </TabsContent>
      <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto">
      {hideVehicle && !(data.flags.enable_reprocess && data.inspection.status === "ready_for_review") ? null : (
      <Panel>
        <VehicleSection hideForm={hideVehicle} />
      </Panel>
      )}
      {line && selection ? (
        <>
          <Panel>
            <IssueSection
              key={line.id}
              line={line}
              onBeginNewClip={() => onBeginNewClip(line.id)}
            />
          </Panel>
        </>
      ) : (
        <Panel>
          <p className="py-6 text-center text-sm text-muted-foreground">Pick an issue or a clip below the video.</p>
        </Panel>
      )}
      </TabsContent>
      <TabsContent value="transcript" className="min-h-0 flex-1 overflow-y-auto">
        <Panel>
          <Transcript player={player} window={transcriptWindow} issueName={line?.component_name} />
        </Panel>
      </TabsContent>
    </Tabs>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 border-b p-4 last:border-b-0">{children}</div>;
}

/* -------------------------------------------------------------- Transcript */

/**
 * Everything the tech said, from the saved transcription. Click a line to jump
 * there; the line being spoken is highlighted. Nothing is shown in its place
 * when there's no transcript: either nothing was said (transcribed_at set) or
 * the inspection was processed before transcripts existed (needs a re-process).
 */
function Transcript({
  player,
  window: span,
  issueName,
}: {
  player: Player;
  window: Range | null;
  issueName?: string;
}) {
  const { data } = useEditor();
  const [whole, setWhole] = useState(false);
  const now = player.now;
  const activeRef = useRef<HTMLLIElement | null>(null);
  const scoped = !!span && !whole;
  const rows = data.transcript.map((t, i) => ({ t, i })).filter(({ t }) => !scoped || (t.end_ms > span!.start && t.start_ms < span!.end));
  const active = data.transcript.findIndex((t) => now >= t.start_ms && now < t.end_ms);
  useEffect(() => {
    if (player.playing) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, player.playing]);

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle
        action={
          span ? (
            <Button variant="ghost" size="sm" onClick={() => setWhole((w) => !w)}>
              {whole ? "This issue only" : "Whole recording"}
            </Button>
          ) : undefined
        }
      >
        {scoped && issueName ? `Transcript · ${issueName}` : "Transcript"}
      </SectionTitle>
      {data.transcript.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {data.inspection.transcribed_at
            ? "Nothing was said in this recording."
            : "This recording has no transcript yet. It was processed before transcripts were saved; re-process it to create one."}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing was said during this issue&apos;s clips.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {rows.map(({ t, i }) => (
            <li key={`${t.start_ms}-${i}`} ref={i === active ? activeRef : undefined}>
              <button
                type="button"
                onClick={() => player.seek(t.start_ms)}
                title="Jump there"
                className={cn(
                  "flex w-full gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  i === active && "bg-accent/60",
                )}
              >
                <span className="w-11 shrink-0 pt-px font-mono text-xs text-muted-foreground tabular-nums">
                  {formatMs(t.start_ms)}
                </span>
                <span className={cn(i === active ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {t.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Only you see this.</p>
    </section>
  );
}

/* -------------------------------------------------------------------- Clip */

/**
 * The selected clip's drawings: when each shows, jump to it, delete it.
 * `hideWhenEmpty` (phone) drops the section, tip included, until there is one.
 */
export function DrawingsSection({
  clip,
  player,
  hideWhenEmpty = false,
}: {
  clip: ClipDetail;
  player: Player;
  hideWhenEmpty?: boolean;
}) {
  const del = useAction();
  const list = [...clip.annotations].sort((a, b) => a.start_ms - b.start_ms);
  if (hideWhenEmpty && list.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>Drawings</SectionTitle>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None yet. Pause inside the clip and press <Brush className="inline size-3.5" /> Draw to mark something for the
          customer.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((a, i) => {
            const shown = insideClip(a, clip);
            return (
              <li key={a.id} className="flex items-center gap-2">
                <button
                  type="button"
                  // A little after the start, past the fade-in, so the drawing is visible.
                  onClick={() => player.seek(Math.max(a.start_ms, clip.start_ms) + Math.min(300, (a.end_ms - a.start_ms) / 2))}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1 text-left hover:bg-muted",
                    !shown && "opacity-60",
                  )}
                >
                  <span className="text-sm font-medium">Drawing {i + 1}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {formatMs(a.start_ms)} · {((a.end_ms - a.start_ms) / 1000).toFixed(0)} s
                    {shown ? "" : " · Outside the clip, not shown"}
                  </span>
                </button>
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete drawing ${i + 1}`}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  }
                  title={`Delete drawing ${i + 1}?`}
                  confirmLabel="Delete drawing"
                  busy={del.busy}
                  error={del.error}
                  onConfirm={() => del.run(() => deleteAnnotation(clip, a.id))}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A clip whose cut failed: re-queue the same range. */
export function RetryCut({ clip }: { clip: ClipDetail }) {
  const retry = useAction();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={retry.busy}
        onClick={() =>
          retry.run(() => apiSend(`/api/clips/${clip.id}`, "PATCH", { start_ms: clip.start_ms, end_ms: clip.end_ms }))
        }
      >
        <RotateCcw /> Retry cut
      </Button>
      {retry.error ? <span className="text-xs text-destructive">{retry.error}</span> : null}
    </>
  );
}

export function DeleteClip({
  line,
  clip,
  n,
  onDeleted,
}: {
  line: LineDetail;
  clip: ClipDetail;
  n: number;
  onDeleted: (nextClipId: string | null) => void;
}) {
  const del = useAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" className="self-start text-destructive hover:bg-destructive/10 hover:text-destructive">
          <Trash2 /> Delete clip
        </Button>
      }
      title={`Delete clip ${n}?`}
      description={
        line.clips.length === 1 ? "It's the issue's only clip; you'll need to add another before sending." : undefined
      }
      confirmLabel="Delete clip"
      busy={del.busy}
      error={del.error}
      onConfirm={async () => {
        const ok = await del.run(() => apiSend(`/api/clips/${clip.id}`, "DELETE"));
        if (ok) onDeleted(clipsByTime(line).find((c) => c.id !== clip.id)?.id ?? null);
        return ok;
      }}
    />
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>
      {action}
    </div>
  );
}

function PhotoSection({ clip, player }: { clip: ClipDetail; player: Player }) {
  const { holdPolling } = useEditor();
  const thumb = useAction();
  const frame = useAction();
  // "Use current frame" is async (worker job): wait for a new frame to show up.
  const [waitingFrame, setWaitingFrame] = useState<{ known: Set<string> } | null>(null);
  const [frameNote, setFrameNote] = useState<string | null>(null);
  const waiting = !!waitingFrame && !clip.frames.some((f) => !waitingFrame.known.has(f.id));
  useEffect(() => {
    if (!waiting) return;
    const release = holdPolling();
    const t = setTimeout(() => {
      setWaitingFrame(null);
      setFrameNote("That frame is taking a while. It will show up here when it's ready.");
    }, 60_000);
    return () => {
      clearTimeout(t);
      release();
    };
  }, [waiting, holdPolling]);

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={frame.busy || waiting}
            onClick={() => {
              const ms = player.current();
              setFrameNote(null);
              if (ms < clip.start_ms || ms > clip.end_ms) {
                setFrameNote(
                  `Move the playhead inside the saved range (${formatMs(clip.start_ms)} – ${formatMs(clip.end_ms)}) first.`,
                );
                return;
              }
              const known = new Set(clip.frames.map((f) => f.id));
              void frame
                .run(() => apiSend(`/api/clips/${clip.id}/frames`, "POST", { timestamp_ms: ms }))
                .then((ok) => ok && setWaitingFrame({ known }));
            }}
          >
            <Camera />
            {waiting ? "Getting frame…" : "Use playhead frame"}
          </Button>
        }
      >
        Photo
      </SectionTitle>
      {frame.error ? <p className="text-sm text-destructive">{frame.error}</p> : null}
      {frameNote ? <p className="text-sm text-muted-foreground">{frameNote}</p> : null}
      {clip.frames.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {clip.status === "pending" ? "Photos appear once the clip is cut." : "No photos yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {clip.frames.map((f) => {
            const on = f.id === clip.thumbnail_frame_id;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={thumb.busy}
                  onClick={() => !on && thumb.run(() => apiSend(`/api/clips/${clip.id}`, "PATCH", { thumbnail_frame_id: f.id }))}
                  onDoubleClick={() => player.seek(f.timestamp_ms)}
                  title="Click to use as the photo · double-click to jump there"
                  className={cn(
                    "relative block w-full overflow-hidden rounded-md ring-2 transition-colors",
                    on ? "ring-primary" : "ring-transparent hover:ring-border",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- proxied media, sizes unknown */}
                  <img src={f.url} alt={`Frame at ${formatMs(f.timestamp_ms)}`} className="media aspect-video w-full" />
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
                    {formatMs(f.timestamp_ms)}
                    {on ? (
                      <span className="flex items-center gap-0.5 font-sans font-medium">
                        <Check className="size-3" /> Photo
                      </span>
                    ) : f.origin === "tech_picked" ? (
                      <span className="font-sans">Yours</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {thumb.error ? <p className="text-sm text-destructive">{thumb.error}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------- Issue */

/** Where on the car the customer's diagram puts this issue. Click a part to save it. */
function ZoneField({ line }: { line: LineDetail }) {
  const save = useAction();
  const set = (car_zone: CarZone | null) => {
    if (car_zone === line.car_zone) return;
    void save.run(() => apiSend(`/api/lines/${line.id}`, "PATCH", { car_zone }));
  };
  const ai = line.ai_suggestion?.car_zone;
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>Where on the car</SectionTitle>
      <div className="flex items-start gap-3">
        <CarDiagram mode="pick" current={line.car_zone} onSelect={set} disabled={save.busy} className="w-24 shrink-0" />
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          <p className="font-medium">{line.car_zone ? CAR_ZONE_LABEL[line.car_zone] : "Not on the car"}</p>
          <p className="text-xs text-muted-foreground">
            The customer sees this part highlighted. Click a part to change it.
          </p>
          {line.ai_suggestion && (ai ?? null) !== line.car_zone ? (
            <p className="text-xs text-muted-foreground">
              Changed from the AI&apos;s suggestion ({ai ? CAR_ZONE_LABEL[ai] : "not on the car"}).
            </p>
          ) : null}
          <Button variant="outline" size="sm" className="self-start" disabled={save.busy || !line.car_zone} onClick={() => set(null)}>
            Not on the car
          </Button>
          {save.error ? <p className="text-xs text-destructive">{save.error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function IssueSection({ line, onBeginNewClip }: { line: LineDetail; onBeginNewClip: () => void }) {
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`studio-name-${line.id}`} className="text-xs text-muted-foreground">
          Issue
        </Label>
        <Input
          id={`studio-name-${line.id}`}
          value={name.value}
          onChange={(e) => name.onChange(e.target.value)}
          onBlur={name.onBlur}
          aria-invalid={name.state === "error" || undefined}
          className="text-base font-semibold md:text-base"
        />
        {nameHint ? (
          <p className={cn("text-xs", name.state === "error" ? "text-destructive" : "text-muted-foreground")}>{nameHint}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>Rating</SectionTitle>
        <RatingPicker
          value={line.rating}
          disabled={rating.busy}
          onChange={(r) => rating.run(() => apiSend(`/api/lines/${line.id}`, "PATCH", { rating: r }))}
        />
        {rating.error ? <p className="text-xs text-destructive">{rating.error}</p> : null}
        {line.ai_suggestion && line.rating !== line.ai_suggestion.rating ? (
          <p className="text-xs text-muted-foreground">Changed from the AI&apos;s suggestion.</p>
        ) : null}
      </div>

      <ZoneField line={line} />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`studio-note-${line.id}`}>Note for the customer</Label>
        <Textarea
          id={`studio-note-${line.id}`}
          value={note.value}
          onChange={(e) => note.onChange(e.target.value)}
          onBlur={note.onBlur}
          rows={4}
          placeholder="What you observed, in plain words"
        />
        {noteHint ? (
          <p className={cn("text-xs", note.state === "error" ? "text-destructive" : "text-muted-foreground")}>{noteHint}</p>
        ) : null}
      </div>

      {warnings.length ? (
        <Alert className="border-amber-border bg-amber-bg text-amber-fg">
          <TriangleAlert />
          <AlertDescription className="text-amber-fg">
            <span className="sr-only">Warnings: </span>
            <ul className="flex flex-col gap-1">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {line.clips.length === 0 ? (
        <Button variant="outline" className="self-start" onClick={onBeginNewClip}>
          <Plus /> New clip
        </Button>
      ) : null}

      <div>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                <Trash2 /> Delete issue
              </Button>
            }
            title="Delete this issue?"
            description={`“${line.component_name}” and its clips will be removed from the report.`}
            confirmLabel="Delete issue"
            busy={del.busy}
            error={del.error}
            onConfirm={() => del.run(() => apiSend(`/api/lines/${line.id}`, "DELETE"))}
          />
      </div>
    </div>
  );
}


/* ----------------------------------------------------------------- Vehicle */

function VehicleSection({ hideForm = false }: { hideForm?: boolean }) {
  const { data } = useEditor();
  const reprocess = useAction();
  const { inspection, flags } = data;
  return (
    <>
      {hideForm ? null : <DetailsForm bare />}
      {flags.enable_reprocess && inspection.status === "ready_for_review" ? (
        <section className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
          <h3 className="text-sm font-medium">Development only</h3>
          <p className="text-sm text-muted-foreground">Run the AI again on this recording without recording again.</p>
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" className="self-start">
                <RotateCcw /> Re-process
              </Button>
            }
            title="Re-process this inspection?"
            description="This replaces all lines, including your edits."
            confirmLabel="Re-process"
            busy={reprocess.busy}
            error={reprocess.error}
            onConfirm={() => reprocess.run(() => apiSend(`/api/inspections/${inspection.id}/reprocess`, "POST"))}
          />
        </section>
      ) : null}
    </>
  );
}
