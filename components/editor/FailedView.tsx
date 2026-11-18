"use client";
/** Failure reason + Retry (POST /api/inspections/[id]/retry). */
import { CircleX, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { apiSend } from "@/lib/fetcher";
import type { InspectionDetail } from "@/lib/types/api";
import { useAction } from "@/components/shared/editor/context";

export function FailedView({ data }: { data: InspectionDetail }) {
  const { run, busy, error } = useAction();
  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-red-bg text-red-fg">
          <CircleX className="size-5" />
        </div>
        <CardTitle>Processing failed</CardTitle>
        <CardDescription>Retry runs processing again on the same recording.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          {data.inspection.failure_reason ?? "Something went wrong while processing."}
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
      <CardFooter>
        <Button
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => run(() => apiSend(`/api/inspections/${data.inspection.id}/retry`, "POST"))}
        >
          <RotateCcw />
          {busy ? "Starting…" : "Retry"}
        </Button>
      </CardFooter>
    </Card>
  );
}
