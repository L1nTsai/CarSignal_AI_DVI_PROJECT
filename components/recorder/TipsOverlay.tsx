"use client";
import { useState } from "react";
import { Button } from "@/components/ui";

const KEY = "carsignal.recorderTips.hidden";

export function tipsHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const TIPS = [
  "Name the part out loud, then show it.",
  "Say the condition: good, monitor, or needs attention.",
  "Hold the camera on each part for 2–3 seconds.",
  "Do one part at a time.",
];

export function TipsOverlay({ onClose }: { onClose: () => void }) {
  const [dontShow, setDontShow] = useState(false);

  const close = () => {
    if (dontShow) {
      try {
        localStorage.setItem(KEY, "1");
      } catch {}
    }
    onClose();
  };

  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tips-title"
        className="w-full max-w-[420px] rounded-lg border border-border bg-background p-5 text-foreground"
      >
        <h2 id="tips-title" className="text-lg font-semibold">
          Before you start
        </h2>
        <ol className="mt-4 flex flex-col gap-3">
          {TIPS.map((t, i) => (
            <li key={t} className="flex gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted">
                {i + 1}
              </span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
        <label className="mt-5 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} className="size-4" />
          Don&apos;t show again
        </label>
        <Button variant="primary" size="lg" full className="mt-4" onClick={close}>
          Got it
        </Button>
      </div>
    </div>
  );
}
