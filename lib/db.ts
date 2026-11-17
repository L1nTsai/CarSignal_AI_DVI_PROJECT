/**
 * Postgres client shared by route handlers, the worker and scripts.
 * Server-only. Never import from a client component.
 *
 * - `sql` is a lazily-created pool (one per process; survives Next.js HMR).
 * - timestamptz values come back as ISO strings, so DB rows and API JSON have
 *   the same shape (see lib/types/db.ts).
 * - bigint (jobs.id, edits.id) comes back as a string.
 * - Use `withActor('ai' | 'tech', tx => ...)` for any transaction that writes
 *   line_items / clips, so the edits log records the right actor.
 */
import postgres, { type Sql, type TransactionSql } from "postgres";
import { env } from "./env";
import type { EditActor } from "./types/db";

const toIso = (v: string) => new Date(v).toISOString();

function create(): Sql {
  return postgres(env().DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    onnotice: () => {},
    types: {
      // timestamptz (1184) and timestamp (1114) -> ISO-8601 string
      isoTimestamp: {
        to: 1184,
        from: [1184, 1114],
        serialize: (x: string | Date) => (x instanceof Date ? x.toISOString() : x),
        parse: toIso,
      },
    },
  }) as unknown as Sql;
}

const g = globalThis as unknown as { __carsignalSql?: Sql };

export function db(): Sql {
  if (!g.__carsignalSql) g.__carsignalSql = create();
  return g.__carsignalSql;
}

/** Tagged-template proxy so callers can write sql`...` directly. */
export const sql: Sql = new Proxy((() => {}) as unknown as Sql, {
  apply: (_t, _this, args) => (db() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const target = db() as unknown as Record<PropertyKey, unknown>;
    const v = target[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});

export type Tx = TransactionSql;

/**
 * Run `fn` in a transaction with `app.actor` set (read by the log_edit trigger).
 * Route handlers editing on behalf of the tech use 'tech'; the worker uses 'ai'.
 */
export async function withActor<T>(actor: EditActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('app.actor', ${actor}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Postgres error from a `raise exception` (e.g. send_report) — message is user-facing. */
export function isRaisedException(e: unknown): e is { code: string; message: string } {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P0001";
}
