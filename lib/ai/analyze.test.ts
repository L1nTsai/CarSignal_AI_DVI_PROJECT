import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobError, NO_COMPONENTS_MESSAGE } from "../../worker/errors";
import { classifyGeminiStatus } from "./errors";

const sdk = vi.hoisted(() => ({
  upload: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      files = { upload: sdk.upload, get: sdk.get, delete: sdk.delete };
      models = { generateContent: sdk.generateContent };
    },
  };
});

const { createAnalyzer } = await import("./analyze");

const brief = readFileSync(path.join(__dirname, "__fixtures__", "brief-tire-wipers.json"), "utf8");
const input = { stitchedPath: "/tmp/stitched.mp4", duration_ms: 30_000, segment_starts_ms: [0, 12_000] };
const analyze = createAnalyzer({ apiKey: "k", model: "gemini-flash-latest", pollIntervalMs: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  sdk.upload.mockResolvedValue({ name: "files/abc", state: "PROCESSING" });
  sdk.get.mockResolvedValue({ name: "files/abc", state: "ACTIVE", uri: "https://x/files/abc", mimeType: "video/mp4" });
  sdk.delete.mockResolvedValue({});
  sdk.generateContent.mockResolvedValue({ text: brief, modelVersion: "gemini-3.8-flash" });
});

describe("createAnalyzer", () => {
  it("uploads, waits for ACTIVE, generates with the schema, deletes, validates", async () => {
    const a = await analyze(input);
    expect(sdk.upload).toHaveBeenCalledWith(expect.objectContaining({ file: input.stitchedPath }));
    expect(sdk.get).toHaveBeenCalledWith({ name: "files/abc" });
    const req = sdk.generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-flash-latest");
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.responseSchema).toBeDefined();
    expect(req.contents[0].parts[0].fileData.fileUri).toBe("https://x/files/abc");
    expect(req.contents[0].parts[1].text).toContain("the parts start at 0:00, 0:12");
    expect(sdk.delete).toHaveBeenCalledWith({ name: "files/abc" });
    expect(a.model).toBe("gemini-3.8-flash"); // resolved model version, not the alias
    expect(a.lines.map((l) => l.component_name)).toEqual(["Left Front Tire", "Wipers"]);
  });

  it("deletes the uploaded file even when generation fails", async () => {
    sdk.generateContent.mockRejectedValue(Object.assign(new Error("boom"), { status: 503 }));
    await expect(analyze(input)).rejects.toThrow("boom");
    expect(sdk.delete).toHaveBeenCalledOnce();
  });

  it("fails when file processing fails", async () => {
    sdk.get.mockResolvedValue({ name: "files/abc", state: "FAILED" });
    await expect(analyze(input)).rejects.toThrow(/state=FAILED/);
    expect(sdk.delete).toHaveBeenCalledOnce();
  });

  it("no components -> non-retryable JobError with the user message", async () => {
    sdk.generateContent.mockResolvedValue({ text: '{"lines":[]}' });
    const err = await analyze(input).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err).toMatchObject({ retryable: false, userMessage: NO_COMPONENTS_MESSAGE });
  });

  it("non-JSON or empty output -> plain (retryable) error", async () => {
    sdk.generateContent.mockResolvedValue({ text: "nope" });
    const e1 = await analyze(input).catch((e) => e);
    expect(e1).not.toBeInstanceOf(JobError);
    sdk.generateContent.mockResolvedValue({ text: undefined, candidates: [{ finishReason: "SAFETY" }] });
    await expect(analyze(input)).rejects.toThrow(/SAFETY/);
  });

  it("billing / auth errors -> non-retryable JobError", async () => {
    sdk.upload.mockRejectedValue(Object.assign(new Error("credits depleted"), { status: 402 }));
    const err = await analyze(input).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err).toMatchObject({ retryable: false, userMessage: expect.stringContaining("out of credits") });
  });

  it("rate limits stay retryable", async () => {
    sdk.generateContent.mockRejectedValue(Object.assign(new Error("slow down"), { status: 429 }));
    const err = await analyze(input).catch((e) => e);
    expect(err).not.toBeInstanceOf(JobError);
  });

  it("sends videoMetadata.fps when configured", async () => {
    await createAnalyzer({ apiKey: "k", model: "m", fps: 2, pollIntervalMs: 1 })(input);
    expect(sdk.generateContent.mock.calls[0][0].contents[0].parts[0].videoMetadata).toEqual({ fps: 2 });
  });
});

describe("classifyGeminiStatus", () => {
  it.each([[undefined, true], [429, true], [500, true], [503, true], [400, false], [401, false], [402, false], [403, false], [404, false]])(
    "%s -> retryable %s",
    (status, retryable) => {
      expect(classifyGeminiStatus(status).retryable).toBe(retryable);
    },
  );
});
