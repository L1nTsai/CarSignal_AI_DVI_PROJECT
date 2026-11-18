"use client";
/**
 * Home data and actions, shared by the mobile and desktop home screens:
 * the inspection list (SWR, polling faster while something is in progress)
 * and "New inspection".
 *
 * New inspection: on a phone (coarse pointer + narrow screen) create and go
 * straight to the recorder; otherwise open /inspections/[id], which shows the
 * pairing QR code (plan §10). This is about the device, not the layout, so a
 * narrow laptop window still gets the QR code.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { apiSend, fetcher } from "@/lib/fetcher";
import type { CreateInspectionResponse, InspectionListResponse } from "@/lib/types/api";

const PHONE_QUERY = "(pointer: coarse) and (max-width: 768px)";

export function useHome() {
  const router = useRouter();
  const { data, error, mutate } = useSWR<InspectionListResponse>("/api/inspections", fetcher, {
    refreshInterval: (d) => (d?.inspections.some((i) => i.status === "processing" || i.status === "recording") ? 2000 : 10000),
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setCreateError(null);
    try {
      const { id } = await apiSend<CreateInspectionResponse>("/api/inspections", "POST");
      const onPhone = window.matchMedia(PHONE_QUERY).matches;
      router.push(onPhone ? `/inspections/${id}/details` : `/inspections/${id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create the inspection.");
      setCreating(false);
    }
  }

  return { data, error, refresh: () => mutate(), creating, createError, create };
}

export type HomeState = ReturnType<typeof useHome>;
