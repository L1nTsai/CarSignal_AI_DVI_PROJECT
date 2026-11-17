import { STATUS_LABEL } from "@/lib/ratings";
import type { InspectionStatus } from "@/lib/types/db";
import { Badge, type BadgeTone } from "./Badge";

const STATUS_TONE: Record<InspectionStatus, BadgeTone> = {
  recording: "gray",
  processing: "blue",
  ready_for_review: "amber",
  sent: "green",
  failed: "red",
};

export function StatusBadge({ status }: { status: InspectionStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
