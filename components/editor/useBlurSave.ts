"use client";
/**
 * Draft-and-save-on-blur for text fields. While the tech types, the draft
 * wins over polled server data; after a successful save (and refresh) the
 * field goes back to showing the server value.
 */
import { useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useBlurSave(
  serverValue: string,
  save: (value: string) => Promise<void>,
  opts: { normalize?: (s: string) => string; validate?: (s: string) => string | null } = {},
) {
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const value = draft ?? serverValue;

  const onChange = (raw: string) => {
    setDraft(opts.normalize ? opts.normalize(raw) : raw);
    if (state !== "idle") setState("idle");
    setError(null);
  };

  const onBlur = async () => {
    if (draft === null) return;
    if (draft === serverValue) {
      setDraft(null);
      return;
    }
    const invalid = opts.validate?.(draft) ?? null;
    if (invalid) {
      setError(invalid);
      setState("error");
      return;
    }
    setState("saving");
    try {
      await save(draft);
      setDraft(null);
      setState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  };

  return { value, onChange, onBlur, state, error, dirty: draft !== null && draft !== serverValue };
}

export function saveHint(state: SaveState, error: string | null): string | null {
  if (state === "saving") return "Saving…";
  if (state === "saved") return "Saved";
  if (state === "error") return error ?? "Couldn't save";
  return null;
}
