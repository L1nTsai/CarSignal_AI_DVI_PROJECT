/** A clip's cut status as a badge (text plus color). Used by both editors. */
import { Badge } from "@/components/ui/badge";
import type { ClipDetail } from "@/lib/types/api";

export function ClipStatus({ clip }: { clip: ClipDetail }) {
  if (clip.status === "ready") return <Badge variant="green">Ready</Badge>;
  if (clip.status === "pending") return <Badge variant="blue">Cutting…</Badge>;
  return <Badge variant="red">Couldn&apos;t cut</Badge>;
}
