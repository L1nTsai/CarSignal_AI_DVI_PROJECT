/** /inspections/[id]/details — phone: customer and vehicle details before recording. */
import { notFound, redirect } from "next/navigation";
import { StartDetails } from "@/components/mobile/details/StartDetails";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/http";
import type { InspectionRow } from "@/lib/types/db";

export const metadata = { title: "New inspection" };

export default async function DetailsPage({ params }: PageProps<"/inspections/[id]/details">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [i] = await sql<
    Pick<InspectionRow, "status" | "customer_name" | "vehicle_year" | "vehicle_make" | "vehicle_model" | "vin">[]
  >`select status, customer_name, vehicle_year, vehicle_make, vehicle_model, vin from inspections where id = ${id}`;
  if (!i) notFound();
  if (i.status !== "recording") redirect(`/inspections/${id}`);

  return (
    <StartDetails
      inspectionId={id}
      initial={{
        customer_name: i.customer_name ?? "",
        vehicle_year: i.vehicle_year ? String(i.vehicle_year) : "",
        vehicle_make: i.vehicle_make ?? "",
        vehicle_model: i.vehicle_model ?? "",
        vin: i.vin ?? "",
      }}
    />
  );
}
