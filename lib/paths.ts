/**
 * Storage layout (plan §5). Pure; safe to import anywhere.
 *
 *   {inspection_id}/segments/{segment_number}/original.{mp4|webm}
 *   {inspection_id}/stitched.mp4
 *   {inspection_id}/clips/{clip_id}/{cut_count}.mp4
 *   {inspection_id}/frames/{frame_id}.jpg
 */

export function segmentExt(mimeType: string): "mp4" | "webm" {
  return mimeType.toLowerCase().startsWith("video/webm") ? "webm" : "mp4";
}

export const storagePaths = {
  segment: (inspectionId: string, n: number, mimeType: string) =>
    `${inspectionId}/segments/${n}/original.${segmentExt(mimeType)}`,
  stitched: (inspectionId: string) => `${inspectionId}/stitched.mp4`,
  /** `cutNumber` is the NEW cut_count (cut_count + 1 at cut time). */
  clip: (inspectionId: string, clipId: string, cutNumber: number) =>
    `${inspectionId}/clips/${clipId}/${cutNumber}.mp4`,
  frame: (inspectionId: string, frameId: string) => `${inspectionId}/frames/${frameId}.jpg`,
  inspectionPrefix: (inspectionId: string) => `${inspectionId}`,
};
