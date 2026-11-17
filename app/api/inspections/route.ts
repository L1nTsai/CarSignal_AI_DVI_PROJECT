/** GET /api/inspections — home list. POST /api/inspections — create (status 'recording'). */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { listInspections } from "@/lib/queries/inspection";
import type { CreateInspectionResponse, InspectionListResponse } from "@/lib/types/api";

export async function GET() {
  const inspections = await listInspections();
  return NextResponse.json<InspectionListResponse>({ inspections }, { headers: { "cache-control": "no-store" } });
}

export async function POST() {
  const [row] = await sql<{ id: string }[]>`insert into inspections default values returning id`;
  return NextResponse.json<CreateInspectionResponse>({ id: row.id }, { status: 201 });
}
