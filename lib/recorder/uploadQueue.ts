/**
 * Serial upload queue for recorded pieces (plan §6). Pure logic: the network
 * is injected as a `Transport`, so this is unit-tested without a browser.
 *
 * - One operation at a time, in order: pending server deletes first, then the
 *   lowest piece that isn't uploaded yet.
 * - Each upload is tried up to 1 + MAX_RETRIES times with backoff. Network
 *   errors and 5xx retry; other 4xx fail at once.
 * - A failed piece stops the queue (the server would reject the next number),
 *   until `retryFailed()`.
 * - `retakeLast()` drops the last piece: unsent -> just forgotten; in flight ->
 *   aborted; on the server (or maybe on it) -> DELETE queued before anything else.
 * - "already uploaded" (409) means the server already has a copy for that
 *   number (e.g. a lost response, or a retake racing an abort). The client's
 *   blob is the truth, so the queue deletes and re-uploads.
 */

export type PieceState = "queued" | "uploading" | "uploaded" | "failed";

export interface Piece {
  n: number;
  state: PieceState;
  /** Recorded length, ms. null when unknown (pieces from an earlier visit). */
  durationMs: number | null;
  /** Upload progress 0..1 while uploading. */
  progress: number;
  error: string | null;
  /** Present for pieces recorded in this visit. */
  blob: Blob | null;
  mimeType: string;
  /** Server check: where the picture stopped while the sound kept going; null = fine or unchecked. */
  videoCutAtMs: number | null;
}

export class TransportError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 for a network error. */
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class AbortedError extends Error {
  constructor() {
    super("aborted");
  }
}

/** What the server reports about a stored piece. */
export interface UploadResult {
  videoCutAtMs: number | null;
}

export interface Transport {
  upload(
    n: number,
    blob: Blob,
    mimeType: string,
    onProgress: (p: number) => void,
    signal: AbortSignal,
  ): Promise<UploadResult | void>;
  /** Must treat "already gone" (404) as success. */
  remove(n: number): Promise<void>;
}

export interface QueueOptions {
  maxRetries?: number;
  /** Delay before retry k (1-based). */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class UploadQueue {
  private pieces: Piece[] = [];
  private pendingDeletes: number[] = [];
  private running = false;
  private current: { n: number; abort: AbortController } | null = null;
  private listeners = new Set<() => void>();
  private idleWaiters: (() => void)[] = [];
  private deleteError: string | null = null;
  private snapshot: readonly Piece[] = [];
  private readonly maxRetries: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly transport: Transport,
    opts: QueueOptions = {},
  ) {
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffMs = opts.backoffMs ?? ((a) => 1000 * 2 ** (a - 1));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  /** Stable snapshot for React's useSyncExternalStore. */
  getPieces = (): readonly Piece[] => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    this.snapshot = this.pieces.map((p) => ({ ...p }));
    for (const fn of this.listeners) fn();
  }

  get nextNumber(): number {
    return (this.pieces.at(-1)?.n ?? 0) + 1;
  }

  /** True when every piece is on the server and nothing is in flight. */
  get settled(): boolean {
    return !this.running && this.pendingDeletes.length === 0 && this.pieces.every((p) => p.state === "uploaded");
  }

  get hasFailure(): boolean {
    return this.deleteError !== null || this.pieces.some((p) => p.state === "failed");
  }

  get failureMessage(): string | null {
    return this.deleteError ?? this.pieces.find((p) => p.state === "failed")?.error ?? null;
  }

  // ── Commands ──────────────────────────────────────────────────────────────
  /** Pieces already on the server from an earlier visit (must be called before add()). */
  seed(pieces: { n: number; durationMs: number | null; mimeType: string; videoCutAtMs?: number | null }[]) {
    this.pieces = pieces
      .slice()
      .sort((a, b) => a.n - b.n)
      .map((p) => ({
        ...p,
        videoCutAtMs: p.videoCutAtMs ?? null,
        state: "uploaded" as const,
        progress: 1,
        error: null,
        blob: null,
      }));
    this.emit();
  }

  /** Server rows that must be deleted (highest first) before recording continues. */
  seedDeletes(numbers: number[]) {
    this.pendingDeletes.push(...numbers.slice().sort((a, b) => b - a));
    void this.pump();
  }

  setDuration(n: number, durationMs: number | null) {
    const p = this.pieces.find((x) => x.n === n);
    if (p) {
      p.durationMs = durationMs;
      this.emit();
    }
  }

  add(blob: Blob, mimeType: string, durationMs: number): number {
    const n = this.nextNumber;
    this.pieces.push({ n, state: "queued", durationMs, progress: 0, error: null, blob, mimeType, videoCutAtMs: null });
    this.emit();
    void this.pump();
    return n;
  }

  /** Discard the last piece wherever it is. Returns its number, or null if there were none. */
  retakeLast(): number | null {
    const last = this.pieces.at(-1);
    if (!last) return null;
    this.pieces.pop();
    if (this.current?.n === last.n) {
      this.current.abort.abort();
      this.pendingDeletes.push(last.n);
    } else if (last.state !== "queued") {
      this.pendingDeletes.push(last.n);
    }
    this.emit();
    void this.pump();
    return last.n;
  }

  retryFailed() {
    this.deleteError = null;
    for (const p of this.pieces) {
      if (p.state === "failed") {
        p.state = "queued";
        p.error = null;
        p.progress = 0;
      }
    }
    this.emit();
    void this.pump();
  }

  /** Resolves once the queue stops: all uploaded (true) or stuck on a failure (false). */
  waitIdle(): Promise<boolean> {
    if (!this.running && (this.settled || this.hasFailure)) return Promise.resolve(this.settled);
    return new Promise((resolve) => this.idleWaiters.push(() => resolve(this.settled)));
  }

  /** Abort anything in flight (page unmount). */
  dispose() {
    this.current?.abort.abort();
    this.listeners.clear();
  }

  // ── Engine ────────────────────────────────────────────────────────────────
  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        if (this.deleteError) break;
        if (this.pendingDeletes.length > 0) {
          const ok = await this.runDelete(this.pendingDeletes[0]);
          if (!ok) break;
          this.pendingDeletes.shift();
          continue;
        }
        const next = this.pieces.find((p) => p.state !== "uploaded");
        if (!next || next.state === "failed") break;
        await this.runUpload(next);
      }
    } finally {
      this.running = false;
      this.emit();
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private async runDelete(n: number): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.transport.remove(n);
        return true;
      } catch (err) {
        if (attempt >= this.maxRetries || !isRetryable(err)) {
          this.deleteError = `Couldn't remove part ${n}: ${messageOf(err)}`;
          return false;
        }
        await this.sleep(this.backoffMs(attempt + 1));
      }
    }
  }

  private async runUpload(piece: Piece) {
    if (!piece.blob) {
      // A piece from an earlier visit that isn't on the server can't be re-sent.
      piece.state = "failed";
      piece.error = "This part is missing. Retake it.";
      return;
    }
    let conflicts = 0;
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController();
      this.current = { n: piece.n, abort };
      piece.state = "uploading";
      piece.progress = 0;
      piece.error = null;
      this.emit();
      try {
        const result = await this.transport.upload(
          piece.n,
          piece.blob,
          piece.mimeType,
          (p) => {
            piece.progress = p;
            this.emit();
          },
          abort.signal,
        );
        piece.state = "uploaded";
        piece.progress = 1;
        piece.videoCutAtMs = result?.videoCutAtMs ?? null;
        return;
      } catch (err) {
        if (err instanceof AbortedError || abort.signal.aborted) return; // retaken; pump moves on
        if (err instanceof TransportError && err.code === "already_uploaded" && conflicts < 2) {
          conflicts++;
          try {
            await this.transport.remove(piece.n);
            attempt--; // re-upload immediately; doesn't count as an attempt
            continue;
          } catch (removeErr) {
            err = removeErr;
          }
        }
        if (attempt >= this.maxRetries || !isRetryable(err)) {
          piece.state = "failed";
          piece.error = messageOf(err);
          return;
        }
        piece.error = `Retrying… (${messageOf(err)})`;
        this.emit();
        await this.sleep(this.backoffMs(attempt + 1));
        // A retake during the backoff removed this piece.
        if (!this.pieces.includes(piece)) return;
      } finally {
        this.current = null;
      }
    }
  }
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof TransportError)) return true;
  return err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
