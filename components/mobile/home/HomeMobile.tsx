"use client";
/**
 * / on a phone (or any window under 1024 px): the inspection list, newest
 * first. No top bar: the CarSignal brand sits top left as plain content (no
 * line, scrolls away); New inspection sits centered in a sticky footer.
 */
import { AlertCircle, Car, Plus } from "lucide-react";
import { Brand, EmptyState, Page } from "@/components/app";
import { InspectionCard } from "@/components/shared/home/InspectionCard";
import { useHome } from "@/components/shared/home/useHome";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const GRID = "grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2";

export function HomeMobile() {
  const { data, error, refresh, creating, createError, create } = useHome();
  const count = data?.inspections.length;

  return (
    <Page
      width="wide"
      header={false}
      footer={
        <div className="flex justify-center">
          <Button size="lg" onClick={create} disabled={creating}>
            <Plus />
            {creating ? "Creating…" : "New inspection"}
          </Button>
        </div>
      }
    >
      <div className="mb-6">
        <Brand />
      </div>

      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inspections</h1>
        <p className="text-sm text-muted-foreground">
          {count === undefined ? "Your recorded walkarounds." : `${count} inspection${count === 1 ? "" : "s"}, newest first.`}
        </p>
      </div>

      {createError ? (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle />
          <AlertTitle>Couldn&apos;t create the inspection</AlertTitle>
          <AlertDescription>{createError}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Couldn&apos;t load inspections</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : !data ? (
        <ul className={GRID} aria-busy="true" aria-label="Loading inspections">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </li>
          ))}
        </ul>
      ) : data.inspections.length === 0 ? (
        <EmptyState title="No inspections yet" icon={<Car />}>
          <p>Record a walkaround and the AI turns it into a report. Tap New inspection below to start.</p>
        </EmptyState>
      ) : (
        <ul className={GRID}>
          {data.inspections.map((i) => (
            <li key={i.id}>
              <InspectionCard item={i} onDeleted={refresh} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
