/**
 * /inspections/[id] — the inspection page; what it shows depends on status
 * (see components/editor/InspectionScreen.tsx).
 */
import { notFound, redirect } from "next/navigation";
import { InspectionScreen } from "@/components/editor/InspectionScreen";
import { sql } from "@/lib/db";
import { getDevice } from "@/lib/device";
import { publicBaseUrl } from "@/lib/baseUrl";
import { isUuid } from "@/lib/http";

export default async function InspectionPage({ params }: PageProps<"/inspections/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  // The QR pairing view is for a laptop. A phone with an unfinished recording goes
  // straight back to the camera instead of showing a QR code for itself.
  const [row] = await sql<{ status: string }[]>`select status from inspections where id = ${id}`;
  if (row?.status === "recording" && (await getDevice()) === "mobile") redirect(`/inspections/${id}/record`);
  // The address is worked out on the server; the pairing QR code needs it on the client.
  return <InspectionScreen id={id} publicBaseUrl={await publicBaseUrl()} />;
}
