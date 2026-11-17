/**
 * analyzeInspection (plan §8): upload stitched.mp4 to the Gemini Files API, wait for
 * ACTIVE, generateContent with a JSON responseSchema, delete the file, then
 * validate/repair into a ValidatedAnalysis. Server-only.
 *
 * Errors:
 *  - nothing usable found      -> JobError(retryable: false, userMessage: NO_COMPONENTS_MESSAGE)
 *  - missing key/model config  -> JobError(retryable: false)
 *  - Gemini 4xx other than 429 (bad key, no credits, unknown model) -> JobError(retryable: false)
 *  - everything else (network, 429/5xx, blocked or non-JSON output) -> plain Error, retried by the worker
 */
import { createPartFromUri, FileState, GoogleGenAI, type Part } from "@google/genai";
import { env } from "../env";
import { JobError, NO_COMPONENTS_MESSAGE } from "../../worker/errors";
import { classifyGeminiStatus, statusOf } from "./errors";
import { buildPrompt } from "./prompt";
import { responseSchema } from "./responseSchema";
import type { AnalyzeFn, AnalyzeInput, ValidatedAnalysis } from "./types";
import { parseModelJson, repairAnalysis } from "./validate";

export interface AnalyzerOptions {
  apiKey?: string;
  model?: string;
  /** Video sampling rate sent to the model (default: model default, 1 fps). Range (0, 24]. */
  fps?: number;
  /** Give up waiting for Files API processing after this long. */
  fileTimeoutMs?: number;
  pollIntervalMs?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export interface RawGeminiResult {
  /** Model version Gemini reports (resolves aliases like gemini-flash-latest), else the requested id. */
  model: string;
  text: string;
  json: unknown;
  usage?: { promptTokens?: number; outputTokens?: number; totalTokens?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function resolveConfig(opts: AnalyzerOptions) {
  const e = opts.apiKey && opts.model ? null : env();
  const apiKey = opts.apiKey || e?.GEMINI_API_KEY || "";
  const model = opts.model || e?.GEMINI_MODEL || "";
  if (!apiKey) throw new JobError("GEMINI_API_KEY is not set", { retryable: false, userMessage: "The AI isn't configured (missing API key)." });
  if (!model) throw new JobError("GEMINI_MODEL is not set", { retryable: false, userMessage: "The AI isn't configured (missing model)." });
  return { apiKey, model };
}

/** Upload → poll → generateContent → delete. Returns the raw (unvalidated) model output. */
export async function callGemini(input: AnalyzeInput, opts: AnalyzerOptions = {}): Promise<RawGeminiResult> {
  const { apiKey, model } = resolveConfig(opts);
  const log = opts.log ?? (() => {});
  const ai = new GoogleGenAI({ apiKey });

  let file = await ai.files.upload({
    file: input.stitchedPath,
    config: { mimeType: "video/mp4", displayName: "inspection.mp4" },
  });
  const name = file.name;
  if (!name) throw new Error("Gemini upload returned no file name");
  log("gemini: uploaded", { name, state: file.state });

  try {
    const deadline = Date.now() + (opts.fileTimeoutMs ?? 5 * 60_000);
    while (file.state === FileState.PROCESSING) {
      if (Date.now() > deadline) throw new Error(`Gemini file ${name} still PROCESSING after timeout`);
      await sleep(opts.pollIntervalMs ?? 2000);
      file = await ai.files.get({ name });
    }
    if (file.state !== FileState.ACTIVE || !file.uri) {
      throw new Error(`Gemini file processing failed: state=${file.state} ${file.error?.message ?? ""}`.trim());
    }
    log("gemini: file active", { name });

    const videoPart: Part = createPartFromUri(file.uri, file.mimeType ?? "video/mp4");
    if (opts.fps) videoPart.videoMetadata = { fps: opts.fps };

    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [videoPart, { text: buildPrompt(input) }] }],
      config: { responseMimeType: "application/json", responseSchema },
    });

    const text = res.text;
    if (!text) {
      const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "unknown";
      throw new Error(`Gemini returned no text (reason: ${reason})`);
    }
    const json = parseModelJson(text);
    if (json === undefined) throw new Error(`Gemini returned non-JSON text: ${text.slice(0, 200)}`);

    const u = res.usageMetadata;
    return {
      model: res.modelVersion || model,
      text,
      json,
      usage: u && { promptTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount, totalTokens: u.totalTokenCount },
    };
  } finally {
    await ai.files.delete({ name }).catch((err: unknown) => {
      log("gemini: file delete failed (it expires in 48h anyway)", { name, error: String(err) });
    });
  }
}

/** Builds an AnalyzeFn. The worker uses the default `analyzeInspection`; the test script passes options. */
export function createAnalyzer(opts: AnalyzerOptions = {}): AnalyzeFn {
  return async (input: AnalyzeInput): Promise<ValidatedAnalysis> => {
    let raw: RawGeminiResult;
    try {
      raw = await callGemini(input, opts);
    } catch (err) {
      const status = statusOf(err);
      const cls = classifyGeminiStatus(status);
      if (err instanceof JobError || cls.retryable) throw err;
      throw new JobError(`Gemini API ${status}: ${err instanceof Error ? err.message : String(err)}`, {
        retryable: false,
        userMessage: cls.userMessage,
      });
    }
    const result = repairAnalysis(raw.json, { duration_ms: input.duration_ms, model: raw.model });
    if (result.ok) return result.analysis;
    if (result.error === "no_lines") {
      throw new JobError(`${result.message} dropped=${JSON.stringify(result.dropped)}`, {
        retryable: false,
        userMessage: NO_COMPONENTS_MESSAGE,
      });
    }
    throw new Error(result.message); // invalid_response: retry
  };
}

/** The AnalyzeFn the worker calls (contract: lib/ai/types.ts). */
export const analyzeInspection: AnalyzeFn = (input) => createAnalyzer()(input);
