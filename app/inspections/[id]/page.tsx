/**
 * /inspections/[id] — the inspection page; what it shows depends on status
 * (see components/editor/InspectionScreen.tsx).
 */
import { InspectionScreen } from "@/components/editor/InspectionScreen";
import { env } from "@/lib/env";

export default async function InspectionPage({ params }: PageProps<"/inspections/[id]">) {
  const { id } = await params;
  // PUBLIC_BASE_URL is server-only; the pairing QR code needs it on the client.
  return <InspectionScreen id={id} publicBaseUrl={env().PUBLIC_BASE_URL} />;
}
