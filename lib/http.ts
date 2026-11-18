/** Small helpers for route handlers. Server-only. */
import { NextResponse } from "next/server";
import type { ApiError } from "./types/api";

export function jsonError(status: number, error: string, code?: string) {
  return NextResponse.json<ApiError>(code ? { error, code } : { error }, { status });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** share_token format: 32 url-safe chars (see send_report). */
export function isShareToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(s);
}
