import type { JobKind, JobRow } from "@/lib/types/db";

export interface JobContext {
  /** Fresh temp directory for this job; removed after the job finishes. */
  tmpDir: string;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface JobHandler {
  /** Do the work. Throw to fail (see worker/errors.ts for retry control). */
  run(job: JobRow, ctx: JobContext): Promise<void>;
  /** Called once when the job has failed for good (no more retries). */
  onFinalFailure?(job: JobRow, error: unknown): Promise<void>;
}

export type HandlerMap = Record<JobKind, JobHandler>;
