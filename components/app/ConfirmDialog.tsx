"use client";
/** Destructive confirmation in an in-page AlertDialog (no browser confirm()). */
import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  busy,
  error,
  open: openProp,
  onOpenChange,
}: {
  /** A single element (usually a Button); rendered as the dialog trigger. Omit when controlling `open`. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  /** Label for the dismiss button; change it when the action itself is a cancel. */
  cancelLabel?: string;
  /** Return false (or throw) to keep the dialog open, e.g. on error. */
  onConfirm: () => Promise<unknown> | unknown;
  busy?: boolean;
  /** Shown inside the dialog when the last attempt failed. */
  error?: ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          {/* A plain Button (not AlertDialogAction) so the dialog stays open while the request runs. */}
          <Button
            variant="destructive-solid"
            disabled={busy}
            onClick={async () => {
              const ok = await onConfirm();
              if (ok !== false) setOpen(false);
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
