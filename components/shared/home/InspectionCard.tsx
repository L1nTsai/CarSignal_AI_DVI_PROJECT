"use client";
/**
 * One inspection on the home screen: photo, title, date, status, and Delete
 * (in-page confirm; processing ones must finish first; deleting a sent one
 * disables the customer link). Used by both layouts for now; fork it into
 * mobile/ or desktop/ when one needs a different card.
 */
import Link from "next/link";
import { useState } from "react";
import { ImageOff, MoreVertical, Trash2 } from "lucide-react";
import { ConfirmDialog, StatusBadge } from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLayout } from "@/components/shared/Responsive";
import { LocalDate } from "@/components/shared/LocalDate";
import { apiSend } from "@/lib/fetcher";
import type { InspectionListItem } from "@/lib/types/api";

export function InspectionCard({ item: i, onDeleted }: { item: InspectionListItem; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicle = [i.vehicle_year, i.vehicle_make, i.vehicle_model].filter(Boolean).join(" ");
  const title = vehicle || i.customer_name || "Untitled inspection";
  const subtitle = vehicle ? i.customer_name : null;
  const processing = i.status === "processing";
  // A draft (recording not finished) reopens the recorder on a phone, the pairing page on a laptop.
  const layout = useLayout();
  const href = i.status === "recording" && layout === "mobile" ? `/inspections/${i.id}/record` : `/inspections/${i.id}`;

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await apiSend(`/api/inspections/${i.id}`, "DELETE");
      onDeleted();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
      return false;
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="group h-full gap-0 py-0 transition-colors hover:ring-foreground/20">
      <Link href={href} tabIndex={-1} aria-hidden className="relative block overflow-hidden">
        {i.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- media proxy URL, no optimizer
          <img
            src={i.photo_url}
            alt=""
            className="media aspect-video w-full transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground">
            <ImageOff className="size-6" />
          </div>
        )}
      </Link>
      <div className="flex flex-1 items-start gap-2 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Link href={href} className="truncate font-medium hover:underline">
            {title}
          </Link>
          <p className="truncate text-sm text-muted-foreground">
            {subtitle ? `${subtitle} · ` : ""}
            <LocalDate iso={i.created_at} />
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <StatusBadge status={i.status} />
            {i.status === "sent" && i.unsent_changes ? <Badge variant="amber">Unsent changes</Badge> : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-mr-1.5 text-muted-foreground" aria-label="More actions">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" disabled={processing} onSelect={() => setConfirming(true)}>
              <Trash2 />
              {processing ? "Delete (wait for processing)" : "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          if (!o) setError(null);
        }}
        title="Delete this inspection?"
        description={
          i.ever_sent
            ? `“${title}”, its recording and every version sent to the customer will be deleted. The customer's link will stop working. This can't be undone.`
            : `“${title}” and its recording will be deleted. This can't be undone.`
        }
        confirmLabel="Delete"
        busy={deleting}
        error={error}
        onConfirm={remove}
      />
    </Card>
  );
}
