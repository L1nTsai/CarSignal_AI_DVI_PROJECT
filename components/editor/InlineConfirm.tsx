"use client";
/** In-page confirmation (no browser confirm()). Renders the trigger, then a confirm row in its place. */
import { useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui";

export function InlineConfirm({
  trigger,
  triggerVariant = "ghost",
  message,
  confirmLabel,
  onConfirm,
  busy,
  disabled,
}: {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant={triggerVariant} size="lg" onClick={() => setOpen(true)} disabled={disabled}>
        {trigger}
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-live="polite" className="flex w-full flex-col gap-3 rounded-md border border-red-border bg-red-bg p-3">
      <p className="text-sm text-red-fg">{message}</p>
      <div className="flex gap-2">
        <Button size="lg" className="flex-1" onClick={() => setOpen(false)} disabled={busy} autoFocus>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="lg"
          className="flex-1"
          disabled={busy}
          onClick={async () => {
            await onConfirm();
            setOpen(false);
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
