"use client";
/**
 * Phone: the screen between New inspection and the camera. The tech can enter
 * the customer and vehicle details now (all optional here; they are needed
 * before Send, and can be added later in the editor) or skip straight to
 * recording. Cancel deletes the still-empty inspection.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, Page } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeVin, vinError, type InspectionPatch } from "@/lib/editor/schemas";
import { apiSend } from "@/lib/fetcher";

export interface StartValues {
  customer_name: string;
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  vin: string;
}

type Errors = Partial<Record<"vehicle_year" | "vin", string>>;

export function StartDetails({ inspectionId, initial }: { inspectionId: string; initial: StartValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<"start" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof StartValues) => (value: string) => setV((s) => ({ ...s, [k]: value }));

  const toRecorder = () => router.replace(`/inspections/${inspectionId}/record`);

  async function start() {
    const year = v.vehicle_year.trim();
    const vin = normalizeVin(v.vin);
    const errs: Errors = {};
    if (year && !(Number(year) >= 1900 && Number(year) <= 2100)) errs.vehicle_year = "Enter a year between 1900 and 2100.";
    const ve = vinError(vin);
    if (ve) errs.vin = ve;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    // Only what was filled in; empty fields stay empty.
    const patch: InspectionPatch = {};
    if (v.customer_name.trim()) patch.customer_name = v.customer_name.trim();
    if (year) patch.vehicle_year = Number(year);
    if (v.vehicle_make.trim()) patch.vehicle_make = v.vehicle_make.trim();
    if (v.vehicle_model.trim()) patch.vehicle_model = v.vehicle_model.trim();
    if (vin) patch.vin = vin;

    setBusy("start");
    setError(null);
    try {
      if (Object.keys(patch).length) await apiSend(`/api/inspections/${inspectionId}`, "PATCH", patch);
      toRecorder();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the details.");
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("cancel");
    await fetch(`/api/inspections/${inspectionId}`, { method: "DELETE" }).catch(() => {});
    router.replace("/");
  }

  return (
    <Page
      title="New inspection"
      actions={
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void cancel()}>
          Cancel
        </Button>
      }
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" disabled={busy !== null} onClick={() => void start()}>
            {busy === "start" ? "Saving…" : "Start recording"}
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={toRecorder}>
            Skip for now
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Customer and vehicle</h1>
          <p className="text-sm text-muted-foreground">Optional now. You&apos;ll need all of it before sending the report.</p>
        </div>
        <Field label="Customer name" htmlFor="start-customer">
          <Input
            id="start-customer"
            value={v.customer_name}
            onChange={(e) => set("customer_name")(e.target.value)}
            placeholder="e.g. Dana Lopez"
            autoComplete="off"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Year" htmlFor="start-year" error={errors.vehicle_year}>
              <Input
                id="start-year"
                value={v.vehicle_year}
                onChange={(e) => set("vehicle_year")(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                placeholder="2019"
                autoComplete="off"
                aria-invalid={errors.vehicle_year ? true : undefined}
              />
            </Field>
          </div>
          <Field label="Make" htmlFor="start-make">
            <Input
              id="start-make"
              value={v.vehicle_make}
              onChange={(e) => set("vehicle_make")(e.target.value)}
              placeholder="Honda"
              autoComplete="off"
            />
          </Field>
          <Field label="Model" htmlFor="start-model">
            <Input
              id="start-model"
              value={v.vehicle_model}
              onChange={(e) => set("vehicle_model")(e.target.value)}
              placeholder="Civic"
              autoComplete="off"
            />
          </Field>
        </div>
        <Field label="VIN" htmlFor="start-vin" error={errors.vin}>
          <Input
            id="start-vin"
            value={v.vin}
            onChange={(e) => set("vin")(normalizeVin(e.target.value).slice(0, 17))}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            maxLength={17}
            placeholder="17 characters"
            className="font-mono tracking-wider"
            aria-invalid={errors.vin ? true : undefined}
          />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Page>
  );
}
