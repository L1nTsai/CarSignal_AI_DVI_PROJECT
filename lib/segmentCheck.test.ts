import { describe, expect, it } from "vitest";
import { videoCutAt, VIDEO_CUT_TOLERANCE_MS } from "./recording";
import { trackEnds } from "./segmentCheck";

describe("trackEnds", () => {
  it("takes the last packet's pts + (capped) duration per track", () => {
    const ends = trackEnds({
      streams: [
        { index: 0, codec_type: "audio" },
        { index: 1, codec_type: "video" },
      ],
      packets: [
        { stream_index: 1, pts_time: "0.000000", duration_time: "0.033333" },
        { stream_index: 0, pts_time: "0.000000", duration_time: "0.021333" },
        // Safari stretches the last frame over the rest of the take.
        { stream_index: 1, pts_time: "17.003333", duration_time: "99.456667" },
        { stream_index: 0, pts_time: "116.437333", duration_time: "0.021333" },
        { stream_index: 0, pts_time: "N/A" },
      ],
    });
    expect(ends.videoEndMs).toBeCloseTo(17503.3, 0);
    expect(ends.audioEndMs).toBeCloseTo(116458.7, 0);
  });

  it("reports a missing track as null", () => {
    expect(trackEnds({ streams: [{ index: 0, codec_type: "audio" }], packets: [] })).toEqual({
      videoEndMs: null,
      audioEndMs: null,
    });
  });
});

describe("videoCutAt", () => {
  it("flags a picture that stops well before the sound", () => {
    expect(videoCutAt(17036.7, 116458.7)).toBe(17037);
  });
  it("allows the small gap a normal stop leaves", () => {
    expect(videoCutAt(10_000, 10_000 + VIDEO_CUT_TOLERANCE_MS)).toBeNull();
    expect(videoCutAt(10_000, 9_800)).toBeNull();
  });
  it("flags a piece with no picture at all", () => {
    expect(videoCutAt(null, 5_000)).toBe(0);
  });
  it("can't judge a piece with no sound", () => {
    expect(videoCutAt(3_000, null)).toBeNull();
  });
});
