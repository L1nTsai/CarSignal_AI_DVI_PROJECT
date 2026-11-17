"use client";
/**
 * / — home list of inspections, newest first (plan §10).
 *
 * New inspection: on a phone (coarse pointer + narrow screen) create and go
 * straight to the recorder; on a laptop open /inspections/[id], which shows
 * the pairing QR code. Inspections can be deleted with an in-page confirm
 * (processing ones must finish first); deleting a sent one disables the customer link.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, EmptyState, Page, StatusBadge } from "@/components/ui";
import { LocalDate } from "@/components/sharing/LocalDate";
import { apiSend, fetcher } from "@/lib/fetcher";
import type { CreateInspectionResponse, InspectionListItem, InspectionListResponse } from "@/lib/types/api";

const PHONE_QUERY = "(pointer: coarse) and (max-width: 768px)";

export default function Home() {
  const router = useRouter();
  const { data, error, mutate } = useSWR<InspectionListResponse>("/api/inspections", fetcher, {
    refreshInterval: (d) => (d?.inspections.some((i) => i.status === "processing" || i.status === "recording") ? 2000 : 10000),
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setCreateError(null);
    try {
      const { id } = await apiSend<CreateInspectionResponse>("/api/inspections", "POST");
      const onPhone = window.matchMedia(PHONE_QUERY).matches;
      router.push(onPhone ? `/inspections/${id}/record` : `/inspections/${id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create the inspection.");
      setCreating(false);
    }
  }

  return (
    <Page
      title="Inspections"
      actions={
        <Button variant="primary" onClick={create} disabled={creating}>
          {creating ? "Creating…" : "New inspection"}
        </Button>
      }
    >
      {createError ? (
        <p role="alert" className="mb-4 text-sm text-red-fg">
          {createError}
        </p>
      ) : null}
      {error ? (
        <EmptyState title="Couldn't load inspections">{error.message}</EmptyState>
      ) : !data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.inspections.length === 0 ? (
        <EmptyState title="No inspections yet">Tap New inspection to record one.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.inspections.map((i) => (
            <li key={i.id}>
              <InspectionRow item={i} onDeleted={() => mutate()} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function InspectionRow({ item: i, onDeleted }: { item: InspectionListItem; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicle = [i.vehicle_year, i.vehicle_make, i.vehicle_model].filter(Boolean).join(" ");
  const title = vehicle || i.customer_name || "Untitled inspection";
  const subtitle = vehicle ? i.customer_name : null;
  const processing = i.status === "processing";

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await apiSend(`/api/inspections/${i.id}`, "DELETE");
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
      setDeleting(false);
    }
  }

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-3 p-3">
        <Link href={`/inspections/${i.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md">
          {i.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- media proxy URL, no optimizer
            <img src={i.photo_url} alt="" className="media size-14 shrink-0 rounded-md" />
          ) : (
            <div aria-hidden className="size-14 shrink-0 rounded-md bg-surface" />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate font-medium">{title}</p>
            <p className="truncate text-sm text-muted">
              {subtitle ? `${subtitle} · ` : ""}
              <LocalDate iso={i.created_at} />
            </p>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={i.status} />
              {i.status === "sent" && i.unsent_changes ? <Badge tone="amber">Unsent changes</Badge> : null}
            </div>
          </div>
        </Link>
        {!confirming ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={processing}
            title={processing ? "Wait for processing to finish" : undefined}
            className="text-red-fg"
          >
            Delete
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2">
          <p className="mr-auto text-sm">
            {i.ever_sent
              ? "Delete this inspection, its recording and every version sent to the customer? The customer's link will stop working. This can't be undone."
              : "Delete this inspection and its recording? This can't be undone."}
          </p>
          <Button size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={remove} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
          {error ? <p className="w-full text-sm text-red-fg">{error}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
