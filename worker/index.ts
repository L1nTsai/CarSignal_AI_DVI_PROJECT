/**
 * Worker entry point (plan §7). Run with `npm run worker`.
 *
 * - Claims one job at a time with claim_job() (FOR UPDATE SKIP LOCKED).
 * - Sleeps 1 s when the queue is empty.
 * - On startup, re-queues `running` jobs locked more than 10 minutes ago.
 * - On failure: retry with backoff (attempts * 30 s) up to MAX_ATTEMPTS, then
 *   mark failed and call the handler's onFinalFailure.
 * - Every transition out of `running` clears locked_at (check constraint).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, sql } from "@/lib/db";
import type { JobRow } from "@/lib/types/db";
import { JobError } from "./errors";
import { cutClip } from "./handlers/cutClip";
import { extractFrame } from "./handlers/extractFrame";
import { processInspection } from "./handlers/processInspection";
import type { HandlerMap, JobContext } from "./types";

const MAX_ATTEMPTS = 3;
const IDLE_MS = 1000;
const STALE_LOCK = "10 minutes";

const handlers: HandlerMap = {
  process_inspection: processInspection,
  cut_clip: cutClip,
  extract_frame: extractFrame,
};

let stopping = false;

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

async function requeueStale() {
  const rows = await sql<{ id: string }[]>`
    update jobs set status = 'queued', locked_at = null, run_after = now()
    where status = 'running' and locked_at < now() - ${STALE_LOCK}::interval
    returning id`;
  if (rows.length) log("requeued stale jobs", { ids: rows.map((r) => r.id) });
}

async function runJob(job: JobRow) {
  const handler = handlers[job.kind];
  const tmpDir = await mkdtemp(path.join(tmpdir(), `carsignal-job-${job.id}-`));
  const ctx: JobContext = {
    tmpDir,
    log: (msg, extra) => log(msg, { job_id: job.id, kind: job.kind, ...extra }),
  };
  const started = Date.now();
  ctx.log("job started", { attempt: job.attempts, inspection_id: job.inspection_id });

  try {
    await handler.run(job, ctx);
    await sql`update jobs set status = 'succeeded', locked_at = null, last_error = null where id = ${job.id}`;
    ctx.log("job succeeded", { ms: Date.now() - started });
  } catch (err) {
    const retryable = !(err instanceof JobError) || err.retryable;
    const final = !retryable || job.attempts >= MAX_ATTEMPTS;
    const text = errorText(err);
    ctx.log("job failed", { ms: Date.now() - started, final, error: text });
    if (err instanceof Error && err.stack) console.error(err.stack);

    if (final) {
      await sql`update jobs set status = 'failed', locked_at = null, last_error = ${text} where id = ${job.id}`;
      try {
        await handler.onFinalFailure?.(job, err);
      } catch (hookErr) {
        ctx.log("onFinalFailure threw", { error: errorText(hookErr) });
      }
    } else {
      await sql`
        update jobs
        set status = 'queued', locked_at = null, last_error = ${text},
            run_after = now() + make_interval(secs => ${job.attempts * 30})
        where id = ${job.id}`;
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  log("worker starting");
  await requeueStale();

  while (!stopping) {
    let job: JobRow | undefined;
    try {
      [job] = await sql<JobRow[]>`select * from claim_job()`;
    } catch (err) {
      log("claim_job failed", { error: errorText(err) });
      await sleep(5000);
      continue;
    }
    if (!job) {
      await sleep(IDLE_MS);
      continue;
    }
    await runJob(job);
  }

  log("worker stopped");
  await db().end({ timeout: 5 });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    log(`${sig} received; finishing current job`);
    stopping = true;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
