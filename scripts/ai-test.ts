/**
 * Run the AI step on real video(s) and print the JSON. Dev tool (plan §13 step 4).
 *
 *   npm run ai:test -- <video> [<video> ...] [--fps 2] [--model gemini-3.8-flash] [--save-raw file.json]
 *
 * One video: sent as is (converted to mp4 first if it isn't one).
 * Several videos: treated as recorded parts — normalized and joined like the worker
 * does, so the prompt gets real cut points.
 *
 * Prints: the raw Gemini JSON, the validated/repaired analysis, and grounding flags.
 * --save-raw writes the raw JSON (plus the inputs) so it can become a test fixture.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ffmpeg, probeDisplaySize, probeDurationMs } from "../worker/lib/ffmpeg";
import { callGemini } from "../lib/ai/analyze";
import { unsupportedNumbers } from "../lib/ai/grounding";
import { formatMmSs } from "../lib/ai/prompt";
import { repairAnalysis } from "../lib/ai/validate";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fps: { type: "string" },
    model: { type: "string" },
    "save-raw": { type: "string" },
    quiet: { type: "boolean", default: false },
  },
});

if (positionals.length === 0) {
  console.error("usage: npm run ai:test -- <video> [<video> ...] [--fps N] [--model id] [--save-raw file.json]");
  process.exit(2);
}

const log = (msg: string, data?: Record<string, unknown>) => console.error(`· ${msg}`, data ? JSON.stringify(data) : "");

async function normalize(input: string, out: string, w: number, h: number) {
  await ffmpeg([
    "-i", input,
    "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-ac", "1", "-b:a", "96k", "-movflags", "+faststart", out,
  ]);
}

async function prepare(tmp: string): Promise<{ stitchedPath: string; segment_starts_ms: number[] }> {
  const inputs = positionals.map((p) => path.resolve(p));
  if (inputs.length === 1 && /\.mp4$/i.test(inputs[0])) return { stitchedPath: inputs[0], segment_starts_ms: [0] };

  const first = await probeDisplaySize(inputs[0]);
  const [w, h] = first.width >= first.height ? [1280, 720] : [720, 1280];
  const pieces: string[] = [];
  const starts: number[] = [];
  let offset = 0;
  for (const [i, input] of inputs.entries()) {
    const out = path.join(tmp, `piece_${i}.mp4`);
    log(`normalizing part ${i + 1}/${inputs.length}`, { input: path.basename(input) });
    await normalize(input, out, w, h);
    starts.push(offset);
    offset += await probeDurationMs(out);
    pieces.push(out);
  }
  if (pieces.length === 1) return { stitchedPath: pieces[0], segment_starts_ms: [0] };
  const list = path.join(tmp, "list.txt");
  await writeFile(list, pieces.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const stitchedPath = path.join(tmp, "stitched.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", stitchedPath]);
  return { stitchedPath, segment_starts_ms: starts };
}

async function main() {
  const tmp = await mkdtemp(path.join(tmpdir(), "carsignal-ai-"));
  try {
    const { stitchedPath, segment_starts_ms } = await prepare(tmp);
    const duration_ms = await probeDurationMs(stitchedPath);
    const input = { stitchedPath, duration_ms, segment_starts_ms };
    log("analyzing", { duration: formatMmSs(duration_ms), parts: segment_starts_ms.map(formatMmSs) });

    const t0 = Date.now();
    const raw = await callGemini(input, {
      model: values.model,
      fps: values.fps ? Number(values.fps) : undefined,
      log,
    });
    log("gemini done", { model: raw.model, seconds: (Date.now() - t0) / 1000, usage: raw.usage });

    if (values["save-raw"]) {
      const fixture = { _input: { files: positionals.map((p) => path.basename(p)), duration_ms, segment_starts_ms, model: raw.model }, ...(raw.json as object) };
      await writeFile(values["save-raw"], JSON.stringify(fixture, null, 2) + "\n");
      log("saved raw output", { file: values["save-raw"] });
    }

    const result = repairAnalysis(raw.json, { duration_ms, model: raw.model });
    const grounding = result.ok
      ? result.analysis.lines.map((l) => ({
          component_name: l.component_name,
          unsupported_numbers: unsupportedNumbers(l.note, l.mentions.map((m) => m.quote)),
        }))
      : [];

    console.log(JSON.stringify({ input: { duration_ms, segment_starts_ms }, raw: raw.json, validated: result, grounding }, null, 2));

    if (!values.quiet && result.ok) {
      console.error("\n── Summary ─────────────────────────────────────────────");
      for (const [i, l] of result.analysis.lines.entries()) {
        const flags = grounding[i].unsupported_numbers;
        console.error(`${i + 1}. ${l.component_name}  [${l.rating}, ${l.rating_basis}]${flags.length ? `  ⚠ unsupported: ${flags.join(", ")}` : ""}`);
        console.error(`   note: ${l.note}`);
        for (const m of l.mentions) {
          console.error(`   ${formatMmSs(m.visible_start_ms)}–${formatMmSs(m.visible_end_ms)} (best ${(m.best_frame_ms / 1000).toFixed(1)}s)  "${m.quote}"`);
        }
      }
      for (const d of result.analysis.dropped) console.error(`dropped: ${d.component_name} — ${d.reason}`);
    } else if (!result.ok) {
      console.error(`\nFAILED (${result.error}): ${result.message}`, result.dropped);
      process.exitCode = 1;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
