import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/ratings";
import type { InspectionStatus } from "@/lib/types/db";
import type { Tone } from "./RatingBadge";

const STATUS_TONE: Record<InspectionStatus, Tone> = {
  recording: "gray",
  processing: "blue",
  ready_for_review: "amber",
  sent: "green",
  failed: "red",
};

export function StatusBadge({ status }: { status: InspectionStatus }) {
  return (
    <Badge variant={STATUS_TONE[status]}>
      {status === "processing" ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {STATUS_LABEL[status]}
    </Badge>
  );
}
