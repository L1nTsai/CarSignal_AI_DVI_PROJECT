"use client";
/** / on a laptop (1024 px and wider): the inspection grid, newest first. */
import { AlertCircle, Car, Plus } from "lucide-react";
import { EmptyState, Page } from "@/components/app";
import { InspectionCard } from "@/components/shared/home/InspectionCard";
import { useHome } from "@/components/shared/home/useHome";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const GRID = "grid grid-cols-3 gap-x-4 gap-y-6";

export function HomeDesktop() {
  const { data, error, refresh, creating, createError, create } = useHome();
  const count = data?.inspections.length;

  return (
    <Page
      width="wide"
      actions={
        <Button onClick={create} disabled={creating}>
          <Plus />
          {creating ? "Creating…" : "New inspection"}
        </Button>
      }
    >
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
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </li>
          ))}
        </ul>
      ) : data.inspections.length === 0 ? (
        <EmptyState title="No inspections yet" icon={<Car />}>
          <p>Record a walkaround and the AI turns it into a report.</p>
          <Button className="mt-4" onClick={create} disabled={creating}>
            <Plus />
            New inspection
          </Button>
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
