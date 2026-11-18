"use client";
/**
 * Header title (phone and laptop): the vehicle name as a button. Opens a window to edit the
 * customer and vehicle details (each field saves when it loses focus).
 * The header is outside the editor provider, so it gets the context passed in.
 */
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DetailsForm } from "@/components/shared/editor/DetailsForm";
import { EditorProvider, type EditorCtx } from "@/components/shared/editor/context";

export function CustomerDialog({ label, ctx }: { label: string; ctx: EditorCtx }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Edit customer and vehicle details: ${label}`}
          className="-mx-1 flex min-w-0 max-w-full items-center gap-1 rounded-md px-1 py-1 text-sm font-semibold hover:bg-accent"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Customer and vehicle</DialogTitle>
          <DialogDescription>Changes save when you leave a field.</DialogDescription>
        </DialogHeader>
        <EditorProvider value={ctx}>
          <DetailsForm bare />
        </EditorProvider>
      </DialogContent>
    </Dialog>
  );
}
