/**
 * Shared bits for the editor's route handlers. Server-only.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { isRaisedException, type Tx } from "../db";
import { jsonError } from "../http";
import type { InspectionStatus } from "../types/db";

/** Lines, clips and frames can be edited only once processing is done. */
export const EDITABLE_STATUSES: readonly InspectionStatus[] = ["ready_for_review", "sent"];

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Parse + validate a JSON body; throws HttpError(400) with the first issue. */
export async function readBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${issue?.message ?? "Invalid body"}`);
  }
  return parsed.data;
}

export function requireUuid(id: string, what: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(404, `${what} not found`);
  }
}

export function assertEditable(status: InspectionStatus) {
  if (!EDITABLE_STATUSES.includes(status)) {
    throw new HttpError(
      409,
      status === "processing"
        ? "This inspection is still processing. Try again when it's ready."
        : `This inspection can't be edited right now (${status.replace(/_/g, " ")}).`,
    );
  }
}

export interface InspectionCtx {
  id: string;
  status: InspectionStatus;
  duration_ms: number | null;
  video_path: string | null;
}

/**
 * Lock the inspection row (FOR SHARE) so its status can't flip under us, e.g.
 * a re-process starting halfway through an edit.
 */
export async function lockInspection(tx: Tx, id: string): Promise<InspectionCtx> {
  const [row] = await tx<InspectionCtx[]>`
    select id, status, duration_ms, video_path from inspections where id = ${id} for share`;
  if (!row) throw new HttpError(404, "Inspection not found");
  return row;
}

export async function lockInspectionOfLine(tx: Tx, lineId: string) {
  const [row] = await tx<{ inspection_id: string }[]>`select inspection_id from line_items where id = ${lineId}`;
  if (!row) throw new HttpError(404, "Line not found");
  return lockInspection(tx, row.inspection_id);
}

export async function lockInspectionOfClip(tx: Tx, clipId: string) {
  const [row] = await tx<{ inspection_id: string; line_item_id: string }[]>`
    select inspection_id, line_item_id from clips where id = ${clipId}`;
  if (!row) throw new HttpError(404, "Clip not found");
  return { inspection: await lockInspection(tx, row.inspection_id), lineId: row.line_item_id };
}

export function assertRangeInVideo(r: { start_ms: number; end_ms: number }, durationMs: number | null) {
  if (durationMs === null) throw new HttpError(409, "The video isn't ready yet");
  if (r.end_ms > durationMs) throw new HttpError(400, "The clip ends after the end of the video");
}

/** Queue a (re-)cut. A clip can have at most one queued cut; that one reads the current range anyway. */
export async function queueCut(tx: Tx, inspectionId: string, clipId: string) {
  await tx`
    insert into jobs (inspection_id, clip_id, kind)
    values (${inspectionId}, ${clipId}, 'cut_clip')
    on conflict (clip_id) where kind = 'cut_clip' and status = 'queued' do nothing`;
}

/** Wrap a handler: HttpError -> its status, known DB errors -> 400/409, else 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    if (isRaisedException(e)) return jsonError(409, e.message);
    const code = (e as { code?: string } | null)?.code;
    if (code === "23514" || code === "23503" || code === "23502") {
      return jsonError(400, "That change isn't allowed");
    }
    if (code === "23505") return jsonError(409, "That conflicts with another change. Reload and try again.");
    console.error("[editor api]", e);
    return jsonError(500, "Something went wrong");
  }
}

export const ok = <T>(body: T, status = 200) => NextResponse.json(body, { status });
