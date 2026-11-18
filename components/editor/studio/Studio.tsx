"use client";
/**
 * Laptop editor:
 *
 *   ┌──────────────────────────────┬──────────────┐
 *   │ Viewer + seek bar            │  Side panel  │
 *   ├──────────────────────────────┤  (vehicle,   │
 *   │ Issues, clips under each     │  transcript, │
 *   └──────────────────────────────┴  issue, clip)┘
 *
 * Ranges are set on the seek bar (drag the selected clip's handles; "New clip"
 * then drag to sweep a range) and kept as drafts per clip until Save. Shortcuts:
 * Space play/pause (always, unless typing), ←/→ step 0.5 s (Shift: 5 s),
 * Enter save, Esc revert, D draw on the selected clip (then Enter saves the
 * drawing and Esc cancels it; the playhead stays put while drawing).
 */
import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { rangeError } from "@/lib/editor/clipRange";
import { apiSend } from "@/lib/fetcher";
import { useAction, useEditor } from "@/components/shared/editor/context";
import { useDrawSession } from "@/components/shared/annotations/useDrawSession";
import { AddLineDialog } from "./AddLineDialog";
import { IssueStrip } from "./IssueStrip";
import { ClipBar } from "./ClipBar";
import { MobileStudio } from "./MobileStudio";
import { SidePanel } from "./SidePanel";
import { usePlayer } from "./usePlayer";
import { Viewer } from "./Viewer";
import { clipKey, clipNumber, clipsByTime, type Range, type Selection } from "./types";

const STRIP_H = 236;

export function Studio({ mobile = false }: { mobile?: boolean }) {
  const { data } = useEditor();
  const player = usePlayer(data.inspection.duration_ms);
  const durationMs = data.inspection.duration_ms ?? player.metaDurationMs ?? 0;
  const { lines } = data;

  const [sel, setSel] = useState<Selection | null>(() =>
    lines[0] ? { lineId: lines[0].id, clipId: lines[0].clips[0]?.id ?? null } : null,
  );
  const [drafts, setDrafts] = useState<Record<string, Range>>({});
  const [addOpen, setAddOpen] = useState(false);
  const save = useAction();

  // Normalize the selection against the latest data (lines/clips can vanish).
  const line = sel ? lines.find((l) => l.id === sel.lineId) : undefined;
  const clip = line && sel?.clipId && sel.clipId !== "new" ? line.clips.find((c) => c.id === sel.clipId) : undefined;
  const selection: Selection | null = line
    ? { lineId: line.id, clipId: sel!.clipId === "new" ? "new" : (clip?.id ?? null) }
    : null;
  const selKey = selection?.clipId ? clipKey(selection.lineId, selection.clipId) : null;

  const savedRange = useCallback(
    (key: string): Range | null => {
      const [lineId, clipId] = key.split(":");
      const c = lines.find((l) => l.id === lineId)?.clips.find((x) => x.id === clipId);
      return c ? { start: c.start_ms, end: c.end_ms } : null;
    },
    [lines],
  );
  const rangeOf = useCallback((key: string) => drafts[key] ?? savedRange(key), [drafts, savedRange]);
  const isDirty = useCallback(
    (key: string) => {
      const d = drafts[key];
      if (!d) return false;
      const s = savedRange(key);
      return !s || s.start !== d.start || s.end !== d.end;
    },
    [drafts, savedRange],
  );

  const range = selKey ? rangeOf(selKey) : null;
  const dirty = selKey ? isDirty(selKey) : false;

  const draw = useDrawSession({
    clip,
    editingRange: dirty || selection?.clipId === "new",
    now: player.now,
    pause: () => player.ref.current?.pause(),
  });

  /*
   * Follow the playhead: when it reaches another flag (a clip's start), select
   * that issue and clip. The current flag is the latest clip start at or before
   * the playhead (on a tie, the selected clip wins). Skipped while a range is
   * being edited so the tech doesn't lose what they're working on.
   */
  let flag: { lineId: string; clipId: string; start: number } | null = null;
  for (const l of lines) {
    for (const c of l.clips) {
      if (c.start_ms > player.now) continue;
      const better =
        !flag || c.start_ms > flag.start || (c.start_ms === flag.start && c.id === selection?.clipId);
      if (better) flag = { lineId: l.id, clipId: c.id, start: c.start_ms };
    }
  }
  const flagKey = flag ? clipKey(flag.lineId, flag.clipId) : null;
  const [prevFlagKey, setPrevFlagKey] = useState(flagKey);
  if (flagKey !== prevFlagKey) {
    setPrevFlagKey(flagKey);
    const editing = dirty || selection?.clipId === "new" || !!draw.state;
    if (flag && !editing && selKey !== flagKey) setSel({ lineId: flag.lineId, clipId: flag.clipId });
  }

  const setRange = useCallback((key: string, r: Range) => setDrafts((d) => ({ ...d, [key]: r })), []);
  const dropDraft = useCallback(
    (key: string) =>
      setDrafts((d) => {
        const rest = { ...d };
        delete rest[key];
        return rest;
      }),
    [],
  );

  const selectClip = (lineId: string, clipId: string | "new" | null) => {
    if (clipId === "new") return beginNewClip(lineId);
    setSel({ lineId, clipId });
    if (clipId) {
      const r = rangeOf(clipKey(lineId, clipId));
      if (r) player.seek(r.start);
    }
  };

  const selectLine = (lineId: string) => {
    const l = lines.find((x) => x.id === lineId);
    const keepClip = sel?.lineId === lineId ? sel.clipId : null;
    setSel({ lineId, clipId: keepClip ?? (l ? clipsByTime(l)[0]?.id : null) ?? null });
  };

  /** New clip for a line: no range yet; the tech drags it out on the seek bar. */
  function beginNewClip(lineId: string) {
    setSel({ lineId, clipId: "new" });
  }

  /**
   * Keep a line's clip order (what the customer sees, and which clip's photo
   * is the line's photo) the same as time order.
   */
  const orderByTime = async (lineId: string, changed: { id: string; start: number; end: number }) => {
    const l = lines.find((x) => x.id === lineId);
    if (!l) return;
    const items = l.clips.map((c) =>
      c.id === changed.id ? changed : { id: c.id, start: c.start_ms, end: c.end_ms },
    );
    if (!items.some((c) => c.id === changed.id)) items.push(changed); // a clip just added (server appends it)
    const byTime = [...items].sort((a, b) => a.start - b.start || a.end - b.end).map((c) => c.id);
    const byPosition = [...l.clips].sort((a, b) => a.position - b.position).map((c) => c.id);
    if (!byPosition.includes(changed.id)) byPosition.push(changed.id);
    if (byTime.join() !== byPosition.join()) {
      await apiSend(`/api/lines/${lineId}/clips/reorder`, "POST", { ids: byTime });
    }
  };

  const saveSelected = () => {
    if (!selection?.clipId || !range || !selKey) return;
    if (rangeError(range.start, range.end, durationMs)) return;
    const key = selKey;
    const { lineId, clipId } = selection;
    void save.run(async () => {
      if (clipId === "new") {
        const res = await apiSend<{ id: string }>(`/api/lines/${lineId}/clips`, "POST", {
          start_ms: range.start,
          end_ms: range.end,
        });
        dropDraft(key);
        setSel({ lineId, clipId: res.id });
        await orderByTime(lineId, { id: res.id, start: range.start, end: range.end });
      } else {
        await apiSend(`/api/clips/${clipId}`, "PATCH", { start_ms: range.start, end_ms: range.end });
        dropDraft(key);
        await orderByTime(lineId, { id: clipId, start: range.start, end: range.end });
      }
    });
  };

  const cancelNew = () => {
    if (!selection) return;
    dropDraft(clipKey(selection.lineId, "new"));
    setSel({ lineId: selection.lineId, clipId: line ? (clipsByTime(line)[0]?.id ?? null) : null });
  };

  const revertSelected = () => {
    if (!selKey) return;
    if (selection?.clipId === "new") cancelNew();
    else dropDraft(selKey);
  };

  // Keyboard shortcuts (not while typing or in a dialog).
  const shortcuts = { saveSelected, revertSelected, dirty, draw };
  useEffect(() => {
    const typing = (t: HTMLElement | null) =>
      !!t?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=alertdialog]");
    const isSpace = (e: KeyboardEvent) => e.key === " " || e.code === "Space";
    // Space only ever plays/pauses: swallow it before a focused button, tab or
    // link can treat it as a click (buttons activate on keyup).
    const onSpaceUp = (e: KeyboardEvent) => {
      if (isSpace(e) && !typing(e.target as HTMLElement | null)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (typing(t)) return;
      const s = shortcuts;
      if (s.draw.state) {
        // Drawing: the frame stays put. Only Enter (save) and Esc (cancel).
        if (e.key === "Escape") s.draw.cancel();
        else if (e.key === "Enter" && !t?.closest("button, a")) {
          e.preventDefault();
          s.draw.save();
        } else if (isSpace(e) || e.key.startsWith("Arrow")) e.preventDefault();
        return;
      }
      if (isSpace(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) player.toggle();
        return;
      }
      const step = e.shiftKey ? 5000 : 500;
      switch (e.key) {
        case "ArrowLeft":
          if (t?.closest("[role=slider]")) return;
          e.preventDefault();
          player.seek(player.current() - step);
          break;
        case "ArrowRight":
          if (t?.closest("[role=slider]")) return;
          e.preventDefault();
          player.seek(player.current() + step);
          break;
        case "Enter":
          if (s.dirty && !t?.closest("button, a")) {
            e.preventDefault();
            s.saveSelected();
          }
          break;
        case "Escape":
          s.revertSelected();
          break;
        case "d":
        case "D":
          if (!s.draw.blocked) {
            e.preventDefault();
            s.draw.start();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onSpaceUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onSpaceUp, true);
    };
  });

  const title = line
    ? `${line.component_name} · ${selection?.clipId === "new" ? "New clip" : clip ? `Clip ${clipNumber(line, clip.id)}` : "No clip"}`
    : null;

  const edit = selection?.clipId
    ? {
        isNew: selection.clipId === "new",
        dirty: dirty || selection.clipId === "new",
        error: range ? rangeError(range.start, range.end, durationMs) : null,
        saving: save.busy,
        saveError: save.error,
        onSave: saveSelected,
        onRevert: revertSelected,
      }
    : null;

  const addDialog = (
    <AddLineDialog
      open={addOpen}
      onOpenChange={setAddOpen}
      onAdded={(id) => {
        setSel({ lineId: id, clipId: null });
      }}
    />
  );

  if (mobile) {
    return (
      <>
        <MobileStudio
          player={player}
          durationMs={durationMs}
          lines={lines}
          selection={selection}
          line={line}
          clip={clip}
          range={range}
          edit={edit}
          title={title}
          status={<SentFlag compact />}
          rangeOf={rangeOf}
          isDirty={isDirty}
          draw={draw}
          onSelectClip={selectClip}
          onSelectLine={selectLine}
          onNewClip={beginNewClip}
          onRangeChange={(r) => selKey && setRange(selKey, r)}
          onAddLine={() => setAddOpen(true)}
        />
        {addDialog}
      </>
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(340px,400px)] gap-3"
        style={{ gridTemplateRows: `minmax(0,1fr) ${STRIP_H}px` }}
      >
        <section aria-label="Viewer" className="col-start-1 row-start-1 min-h-0 rounded-xl ring-1 ring-foreground/10">
          <Viewer
            videoUrl={data.video_url}
            player={player}
            durationMs={durationMs}
            title={title}
            range={range}
            onNewClip={selection ? () => beginNewClip(selection.lineId) : null}
            onRangeChange={(r) => selKey && setRange(selKey, r)}
            edit={edit}
            status={<SentFlag />}
            lines={lines}
            selection={selection}
            onSelectClip={selectClip}
            annotations={clip?.annotations ?? []}
            draw={draw}
            clipBar={line && clip ? <ClipBar line={line} clip={clip} player={player} onSelectClip={selectClip} /> : null}
          />
        </section>

        <section
          aria-label="Issues"
          className="col-start-1 row-start-2 min-h-0 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
        >
          <IssueStrip
            lines={lines}
            selection={selection}
            rangeOf={rangeOf}
            isDirty={isDirty}
            onSelectClip={selectClip}
            onSelectLine={selectLine}
            onAddLine={() => setAddOpen(true)}
          />
        </section>

        <aside
          aria-label="Details"
          className="col-start-2 row-span-2 row-start-1 min-h-0 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
        >
          <SidePanel
            hideVehicle
            selection={selection}
            line={line}
            clip={clip}
            player={player}
            onSelectClip={selectClip}
            onBeginNewClip={(id) => beginNewClip(id)}
          />
        </aside>
      </div>

      {addDialog}
    </TooltipProvider>
  );
}

/** Top-right of the video: sent version, whether there are unsent changes, and what that means. */
function SentFlag({ compact = false }: { compact?: boolean }) {
  const { data } = useEditor();
  const { inspection, sending } = data;
  if (inspection.status !== "sent") return null;
  const v = sending.latest_version?.version_number;
  return (
    <div className="flex max-w-72 flex-col gap-1 rounded-md bg-black/60 px-2.5 py-2 text-xs text-white backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Send className="size-3.5 text-blue-fg" />
        <span className="font-medium">Sent{v ? ` (version ${v})` : ""}</span>
        {sending.unsent_changes ? (
          <Badge variant="amber">Unsent changes</Badge>
        ) : null}
      </div>
      {compact ? null : <p className="text-white/75">
        {sending.unsent_changes
          ? "The customer sees your edits after you send an update."
          : "The customer is seeing the latest version."}
      </p>}
    </div>
  );
}
