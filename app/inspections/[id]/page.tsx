/**
 * /inspections/[id] — the inspection page; what it shows depends on status.
 *
 * SHELL: the sharing agent built the `recording` (laptop pairing) view and the
 * Send bar. The editor agent owns the rest (processing, failed, the editor
 * itself) and should replace the placeholders in InspectionView.tsx, keeping
 * <PairingView> and <SendBar>.
 */
import { env } from "@/lib/env";
import { InspectionView } from "./InspectionView";

export default async function InspectionPage(props: PageProps<"/inspections/[id]">) {
  const { id } = await props.params;
  // PUBLIC_BASE_URL is server-only; the QR code needs it on the client.
  return <InspectionView id={id} publicBaseUrl={env().PUBLIC_BASE_URL} />;
}
