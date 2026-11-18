"use client";
/** Customer + vehicle details. Each field saves when it loses focus. All five are required before Send. */
import type { ComponentProps } from "react";
import { Field } from "@/components/app";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { normalizeVin, vinError, type InspectionPatch } from "@/lib/editor/schemas";
import { apiSend } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { useEditor } from "./context";
import { saveHint, useBlurSave } from "./useBlurSave";

type Key = "customer_name" | "vehicle_year" | "vehicle_make" | "vehicle_model" | "vin";

function DetailField({
  field,
  label,
  serverValue,
  toPatch,
  normalize,
  validate,
  inputProps,
  className,
}: {
  field: Key;
  label: string;
  serverValue: string;
  toPatch: (v: string) => InspectionPatch;
  normalize?: (s: string) => string;
  validate?: (s: string) => string | null;
  inputProps?: ComponentProps<"input">;
  className?: string;
}) {
  const { data, refresh } = useEditor();
  const s = useBlurSave(
    serverValue,
    async (v) => {
      await apiSend(`/api/inspections/${data.inspection.id}`, "PATCH", toPatch(v));
      await refresh();
    },
    { normalize, validate },
  );
  const id = `detail-${field}`;
  const hint = saveHint(s.state, s.error);
  return (
    <div className={className}>
      <Field
        label={label}
        htmlFor={id}
        error={s.state === "error" ? hint : undefined}
        hint={s.state !== "error" ? (hint ?? undefined) : undefined}
      >
        <Input
          id={id}
          value={s.value}
          onChange={(e) => s.onChange(e.target.value)}
          onBlur={s.onBlur}
          aria-invalid={s.state === "error" || undefined}
          {...inputProps}
        />
      </Field>
    </div>
  );
}

const text = (field: Exclude<Key, "vehicle_year">) => (v: string) => ({ [field]: v }) as InspectionPatch;

/** `bare`: no card chrome (inside the studio inspector). */
export function DetailsForm({ bare = false }: { bare?: boolean }) {
  const { inspection: i } = useEditor().data;
  const missing = [
    !i.customer_name && "customer name",
    !i.vehicle_year && "year",
    !i.vehicle_make && "make",
    !i.vehicle_model && "model",
    !i.vin && "VIN",
  ].filter(Boolean) as string[];

  return (
    <Card className={cn(bare && "gap-4 bg-transparent py-0 ring-0")}>
      <CardHeader className={cn(bare && "px-0")}>
        <CardTitle>Customer and vehicle</CardTitle>
        <CardDescription className={cn(missing.length && "text-amber-fg")}>
          {missing.length ? `Needed before sending: ${missing.join(", ")}.` : "All details filled in."}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-4", bare && "px-0")}>
      <DetailField
        field="customer_name"
        label="Customer name"
        serverValue={i.customer_name ?? ""}
        toPatch={text("customer_name")}
        inputProps={{ autoComplete: "off", placeholder: "e.g. Dana Lopez" }}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[6rem_1fr_1fr]">
        <DetailField
          field="vehicle_year"
          label="Year"
          serverValue={i.vehicle_year ? String(i.vehicle_year) : ""}
          normalize={(s) => s.replace(/\D/g, "").slice(0, 4)}
          validate={(s) =>
            s === "" || (Number(s) >= 1900 && Number(s) <= 2100) ? null : "Enter a year between 1900 and 2100."
          }
          toPatch={(v) => ({ vehicle_year: v === "" ? null : Number(v) })}
          inputProps={{ inputMode: "numeric", placeholder: "2019", autoComplete: "off" }}
          className="col-span-2 sm:col-span-1"
        />
        <DetailField
          field="vehicle_make"
          label="Make"
          serverValue={i.vehicle_make ?? ""}
          toPatch={text("vehicle_make")}
          inputProps={{ placeholder: "Honda", autoComplete: "off" }}
        />
        <DetailField
          field="vehicle_model"
          label="Model"
          serverValue={i.vehicle_model ?? ""}
          toPatch={text("vehicle_model")}
          inputProps={{ placeholder: "Civic", autoComplete: "off" }}
        />
      </div>
      <DetailField
        field="vin"
        label="VIN"
        serverValue={i.vin ?? ""}
        normalize={(s) => normalizeVin(s).slice(0, 17)}
        validate={vinError}
        toPatch={text("vin")}
        inputProps={{
          autoCapitalize: "characters",
          autoCorrect: "off",
          spellCheck: false,
          autoComplete: "off",
          maxLength: 17,
          placeholder: "17 characters",
          className: "font-mono tracking-wider",
        }}
      />
      </CardContent>
    </Card>
  );
}
