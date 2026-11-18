import { describe, expect, it } from "vitest";
import type { ClipDetail, InspectionDetail, LineDetail } from "../types/api";
import type { InspectionRow } from "../types/db";
import { sendBlockers } from "./sendReadiness";

const insp = (over: Partial<InspectionRow> = {}): InspectionRow => ({
  id: "i",
  customer_name: "Dana",
  vehicle_year: 2020,
  vehicle_make: "Toyota",
  vehicle_model: "RAV4",
  vin: "2T3P1RFV8MC123456",
  status: "ready_for_review",
  processing_step: null,
  failure_reason: null,
  video_path: "i/stitched.mp4",
  duration_ms: 1000,
  share_token: null,
  transcribed_at: null,
  created_at: "",
  updated_at: "",
  ...over,
});

const clip = (over: Partial<ClipDetail> = {}): ClipDetail =>
  ({ id: "c", position: 1, status: "ready", thumbnail_frame_id: "f", ...over }) as ClipDetail;

const line = (over: Partial<LineDetail> = {}): LineDetail =>
  ({ id: "l", position: 1, component_name: "Wipers", note: "Look good.", rating: "good", clips: [clip()], ...over }) as LineDetail;

const detail = (
  i: Partial<InspectionRow> = {},
  lines: LineDetail[] = [line()],
  sending: Partial<InspectionDetail["sending"]> = {},
) => ({
  inspection: insp(i),
  lines,
  sending: { latest_version: null, share_url: null, unsent_changes: false, ...sending },
});

describe("sendBlockers", () => {
  it("allows a complete report", () => {
    expect(sendBlockers(detail())).toEqual([]);
  });

  it("blocks while processing", () => {
    expect(sendBlockers(detail({ status: "processing", processing_step: "cutting" }))).toEqual([
      "The inspection isn't ready to send yet.",
    ]);
  });

  it("lists every missing detail in one reason", () => {
    expect(sendBlockers(detail({ vin: null, vehicle_make: null }))).toEqual(["Add the make and VIN."]);
    expect(sendBlockers(detail({ vin: null }))).toEqual(["Add the VIN."]);
  });

  it("requires at least one line", () => {
    expect(sendBlockers(detail({}, []))).toEqual(["Add at least one line."]);
  });

  it("names lines with an empty note, no clips, or unusable clips", () => {
    const r = sendBlockers(
      detail({}, [
        line({ component_name: "Tire", note: "  " }),
        line({ component_name: "Battery", clips: [] }),
        line({ component_name: "Brakes", clips: [clip({ status: "pending", thumbnail_frame_id: null })] }),
        line({ component_name: "Filter", clips: [clip(), clip({ status: "failed" })] }),
        line({ component_name: "Hoses", clips: [clip({ thumbnail_frame_id: null })] }),
      ]),
    );
    expect(r).toEqual([
      "“Tire” needs a note.",
      "“Battery” needs a clip.",
      "“Brakes” has a clip that's still being cut.",
      "“Filter” has a clip that failed. Retry or delete it.",
      "“Hoses” has a clip without a photo.",
    ]);
  });

  it("blocks Send update when nothing changed", () => {
    const d = detail({ status: "sent", share_token: "t" }, [line()], {
      latest_version: { version_number: 2, sent_at: "" },
      unsent_changes: false,
    });
    expect(sendBlockers(d)).toEqual(["Nothing has changed since version 2."]);
  });

  it("allows Send update when there are unsent changes", () => {
    const d = detail({ status: "sent", share_token: "t" }, [line()], {
      latest_version: { version_number: 2, sent_at: "" },
      unsent_changes: true,
    });
    expect(sendBlockers(d)).toEqual([]);
  });
});
