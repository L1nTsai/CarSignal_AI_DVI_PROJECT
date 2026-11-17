import { InspectionScreen } from "@/components/editor/InspectionScreen";

export default async function InspectionPage({ params }: PageProps<"/inspections/[id]">) {
  const { id } = await params;
  return <InspectionScreen id={id} />;
}
