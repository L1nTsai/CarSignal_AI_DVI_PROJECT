"use client";
/**
 * Shared state for the inspection page: the polled InspectionDetail plus a
 * `refresh` to re-fetch after a mutation. Mutations go through `useAction`,
 * which tracks busy/error so every control can explain a failed save in place.
 */
import { createContext, useCallback, useContext, useState } from "react";
import type { InspectionDetail } from "@/lib/types/api";

export interface EditorCtx {
  data: InspectionDetail;
  refresh: () => Promise<unknown>;
  /** Ask the page to poll (e.g. while a frame is being extracted). Returns an undo. */
  holdPolling: () => () => void;
}

const Ctx = createContext<EditorCtx | null>(null);
export const EditorProvider = Ctx.Provider;

export function useEditor(): EditorCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor outside EditorProvider");
  return v;
}

/** Run a mutation, then refresh. Errors are kept for display, not thrown. */
export function useAction() {
  const { refresh } = useEditor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        // The server may have moved on (e.g. line deleted elsewhere); resync.
        void refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  return { run, busy, error, clearError: () => setError(null) };
}
