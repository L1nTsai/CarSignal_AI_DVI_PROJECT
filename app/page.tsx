"use client";
/**
 * PLACEHOLDER home (owned by the home-list agent, plan §10 "/ Home").
 * Shows the polling pattern: SWR against the JSON API, no direct DB access.
 */
import Link from "next/link";
import useSWR from "swr";
import { Card, EmptyState, Page, StatusBadge } from "@/components/ui";
import { fetcher } from "@/lib/fetcher";
import type { InspectionListResponse } from "@/lib/types/api";

export default function Home() {
  const { data, error } = useSWR<InspectionListResponse>("/api/inspections", fetcher, { refreshInterval: 5000 });

  return (
    <Page title="Inspections">
      {error ? (
        <EmptyState title="Couldn't load inspections">{String(error.message ?? error)}</EmptyState>
      ) : !data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.inspections.length === 0 ? (
        <EmptyState title="No inspections yet">Run `npm run seed:demo` to add demo data.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.inspections.map((i) => (
            <li key={i.id}>
              <Link href={`/inspections/${i.id}`}>
                <Card className="flex items-center justify-between gap-3 p-4 hover:bg-surface">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {i.vehicle_make
                        ? `${i.vehicle_year ?? ""} ${i.vehicle_make} ${i.vehicle_model ?? ""}`.trim()
                        : "Untitled inspection"}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {i.customer_name ?? "No customer"} · {new Date(i.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusBadge status={i.status} />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
