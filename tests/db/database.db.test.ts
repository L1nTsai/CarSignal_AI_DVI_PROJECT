/**
 * Database tests (plan §14) against the local Supabase Postgres.
 * Run with `npm run test:db` (needs `supabase start` and .env.local).
 *
 * Every test runs inside a transaction that is ALWAYS rolled back, so the
 * local data is never changed. Expected failures run inside a savepoint so the
 * outer transaction stays usable.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql, type Tx } from "@/lib/db";

class Rollback extends Error {}

/** Run `fn` in a transaction, then roll it back. */
async function inTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** Expect a statement to fail without aborting the surrounding transaction. */
async function rejects(tx: Tx, fn: (sp: Tx) => Promise<unknown>, pattern: RegExp) {
  await expect(tx.savepoint((sp) => fn(sp as unknown as Tx))).rejects.toThrow(pattern);
}

const actor = (tx: Tx, a: "tech" | "ai") => tx`select set_config('app.actor', ${a}, true)`;

const VIN = "1HGCM82633A004352";

// ── Fixtures (all inside the caller's transaction) ───────────────────────────

async function readyInspection(tx: Tx, details = true): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into inspections (status, video_path, duration_ms, customer_name, vehicle_year, vehicle_make, vehicle_model, vin)
    values ('ready_for_review', 'x/stitched.mp4', 60000,
            ${details ? "Pat" : null}, ${details ? 2019 : null}, ${details ? "Toyota" : null},
            ${details ? "RAV4" : null}, ${details ? VIN : null})
    returning id`;
  return row.id;
}

async function addLine(tx: Tx, inspectionId: string, position: number, note = "Looks good.") {
  const [row] = await tx<{ id: string }[]>`
    insert into line_items (inspection_id, position, component_name, note, rating)
    values (${inspectionId}, ${position}, ${`Part ${position}`}, ${note}, 'good') returning id`;
  return row.id;
}

/** A clip; `ready` gives it a path and a thumbnail frame of its own. */
async function addClip(
  tx: Tx,
  inspectionId: string,
  lineId: string,
  position: number,
  opts: { ready?: boolean; thumbnail?: boolean } = {},
) {
  const { ready = true, thumbnail = true } = opts;
  const [clip] = await tx<{ id: string }[]>`
    insert into clips (inspection_id, line_item_id, position, start_ms, end_ms)
    values (${inspectionId}, ${lineId}, ${position}, 0, 5000) returning id`;
  const [frame] = await tx<{ id: string; storage_path: string }[]>`
    insert into frames (clip_id, timestamp_ms, storage_path, origin, sharpness)
    values (${clip.id}, 1000, ${`x/frames/${clip.id}.jpg`}, 'ai_candidate', 10) returning id, storage_path`;
  if (ready) {
    await tx`update clips set status = 'ready', path = ${`x/clips/${clip.id}/1.mp4`}, cut_count = 1,
                              thumbnail_frame_id = ${thumbnail ? frame.id : null}
             where id = ${clip.id}`;
  }
  return { clipId: clip.id, frameId: frame.id, framePath: frame.storage_path };
}

/** An inspection that passes every send_report check: one line, one ready clip. */
async function sendable(tx: Tx) {
  const id = await readyInspection(tx);
  const lineId = await addLine(tx, id, 1);
  const clip = await addClip(tx, id, lineId, 1);
  return { id, lineId, ...clip };
}

const send = (tx: Tx, id: string) => tx<{ token: string }[]>`select send_report(${id}) as token`;

afterAll(async () => {
  await sql.end();
});

// ── send_report ──────────────────────────────────────────────────────────────

describe("send_report refuses", () => {
  it("an inspection that isn't ready", () =>
    inTx(async (tx) => {
      const [row] = await tx<{ id: string }[]>`insert into inspections default values returning id`;
      await rejects(tx, (sp) => send(sp, row.id), /not ready to send \(status recording\)/);
    }));

  it("missing customer or vehicle details", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx, false);
      const lineId = await addLine(tx, id, 1);
      await addClip(tx, id, lineId, 1);
      await rejects(tx, (sp) => send(sp, id), /details are incomplete/);
    }));

  it("a report with no lines", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      await rejects(tx, (sp) => send(sp, id), /report has no lines/);
    }));

  it("a line with an empty note", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const lineId = await addLine(tx, id, 1, "   ");
      await addClip(tx, id, lineId, 1);
      await rejects(tx, (sp) => send(sp, id), /"Part 1" needs a note/);
    }));

  it("a line with no clips", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      await addLine(tx, id, 1);
      await rejects(tx, (sp) => send(sp, id), /"Part 1" needs a note and at least one ready clip/);
    }));

  it("a clip that isn't ready", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const lineId = await addLine(tx, id, 1);
      await addClip(tx, id, lineId, 1, { ready: false });
      await rejects(tx, (sp) => send(sp, id), /ready clip with a thumbnail/);
    }));

  it("a ready clip without a thumbnail", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const lineId = await addLine(tx, id, 1);
      await addClip(tx, id, lineId, 1, { thumbnail: false });
      await rejects(tx, (sp) => send(sp, id), /ready clip with a thumbnail/);
    }));

  it("and saves nothing when it refuses", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      await addLine(tx, id, 1);
      await rejects(tx, (sp) => send(sp, id), /needs a note/);
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from report_versions where inspection_id = ${id}`;
      const [insp] = await tx<{ status: string; share_token: string | null }[]>`
        select status, share_token from inspections where id = ${id}`;
      expect(n).toBe(0);
      expect(insp).toEqual({ status: "ready_for_review", share_token: null });
    }));
});

describe("send_report frozen copies", () => {
  it("creates v1 then v2 with one stable token, and v1 doesn't change after edits", () =>
    inTx(async (tx) => {
      const s = await sendable(tx);
      const [{ token }] = await send(tx, s.id);
      expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);

      await actor(tx, "tech");
      await tx`update line_items set note = 'Edited after v1.' where id = ${s.lineId}`;
      const [{ token: token2 }] = await send(tx, s.id);
      expect(token2).toBe(token);

      const versions = await tx<{ version_number: number; note: string; clip_path: string; thumbnail_path: string }[]>`
        select v.version_number, l.note, c.clip_path, c.thumbnail_path
        from report_versions v
        join report_version_lines l on l.report_version_id = v.id
        join report_version_clips c on c.report_version_line_id = l.id
        where v.inspection_id = ${s.id} order by v.version_number`;
      expect(versions).toEqual([
        { version_number: 1, note: "Looks good.", clip_path: `x/clips/${s.clipId}/1.mp4`, thumbnail_path: s.framePath },
        { version_number: 2, note: "Edited after v1.", clip_path: `x/clips/${s.clipId}/1.mp4`, thumbnail_path: s.framePath },
      ]);
      const [insp] = await tx<{ status: string }[]>`select status from inspections where id = ${s.id}`;
      expect(insp.status).toBe("sent");
    }));

  it("frozen copies survive deleting the live line", () =>
    inTx(async (tx) => {
      const s = await sendable(tx);
      await send(tx, s.id);
      await tx`delete from line_items where id = ${s.lineId}`;
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from report_version_lines l
        join report_versions v on v.id = l.report_version_id where v.inspection_id = ${s.id}`;
      expect(n).toBe(1);
    }));
});

// ── Constraints (plan §4 "Rules the database enforces") ──────────────────────

describe("constraints reject bad rows", () => {
  it("an invalid VIN (I/O/Q, wrong length, lowercase)", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx, false);
      for (const vin of ["1HGCM82633A00435", "1HGCM82633A00435I", "1hgcm82633a004352"]) {
        await rejects(tx, (sp) => sp`update inspections set vin = ${vin} where id = ${id}`, /inspections_vin_check/);
      }
    }));

  it("processing_step without processing, and share_token without sent", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      await rejects(tx, (sp) => sp`update inspections set processing_step = 'cutting' where id = ${id}`, /processing_step_iff_processing/);
      await rejects(tx, (sp) => sp`update inspections set share_token = 'abc' where id = ${id}`, /share_token_iff_sent/);
    }));

  it("sent without every detail", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx, false);
      await rejects(
        tx,
        (sp) => sp`update inspections set status = 'sent', share_token = 'abc' where id = ${id}`,
        /details_present_when_sent/,
      );
    }));

  it("clip ranges: end before start, longer than 60 s", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const lineId = await addLine(tx, id, 1);
      await rejects(
        tx,
        (sp) => sp`insert into clips (inspection_id, line_item_id, position, start_ms, end_ms) values (${id}, ${lineId}, 1, 5000, 5000)`,
        /clips_check/,
      );
      await rejects(
        tx,
        (sp) => sp`insert into clips (inspection_id, line_item_id, position, start_ms, end_ms) values (${id}, ${lineId}, 1, 0, 60001)`,
        /clips_check/,
      );
    }));

  it("a ready clip with no path", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const lineId = await addLine(tx, id, 1);
      const { clipId } = await addClip(tx, id, lineId, 1, { ready: false });
      await rejects(tx, (sp) => sp`update clips set status = 'ready' where id = ${clipId}`, /clips_check/);
    }));

  it("a thumbnail that belongs to another clip", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const lineId = await addLine(tx, id, 1);
      const a = await addClip(tx, id, lineId, 1);
      const b = await addClip(tx, id, lineId, 2);
      await rejects(
        tx,
        (sp) => sp`update clips set thumbnail_frame_id = ${b.frameId} where id = ${a.clipId}`,
        /clips_thumbnail_belongs_to_clip/,
      );
    }));

  it("a clip pointing at another inspection's line", () =>
    inTx(async (tx) => {
      const a = await readyInspection(tx);
      const b = await readyInspection(tx);
      const lineOfA = await addLine(tx, a, 1);
      await rejects(
        tx,
        (sp) => sp`insert into clips (inspection_id, line_item_id, position, start_ms, end_ms) values (${b}, ${lineOfA}, 1, 0, 5000)`,
        /violates foreign key constraint/,
      );
    }));

  it("a second active process_inspection job", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      await tx`insert into jobs (inspection_id, kind) values (${id}, 'process_inspection')`;
      await rejects(tx, (sp) => sp`insert into jobs (inspection_id, kind) values (${id}, 'process_inspection')`, /jobs_one_active_process/);
    }));
});

describe("reorder_lines / reorder_clips", () => {
  it("reject a list that isn't every row exactly once, and apply a valid one", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const l1 = await addLine(tx, id, 1);
      const l2 = await addLine(tx, id, 2);
      await rejects(tx, (sp) => sp`select reorder_lines(${id}, ${[l1]}::uuid[])`, /every line of the inspection exactly once/);
      await rejects(tx, (sp) => sp`select reorder_lines(${id}, ${[l1, l1]}::uuid[])`, /exactly once/);

      await tx`select reorder_lines(${id}, ${[l2, l1]}::uuid[])`;
      await tx`set constraints line_items_position_key immediate`; // checked now instead of at commit
      const rows = await tx<{ id: string }[]>`select id from line_items where inspection_id = ${id} order by position`;
      expect(rows.map((r) => r.id)).toEqual([l2, l1]);

      const c1 = await addClip(tx, id, l1, 1);
      await addClip(tx, id, l1, 2);
      await rejects(tx, (sp) => sp`select reorder_clips(${l1}, ${[c1.clipId]}::uuid[])`, /every clip of the line exactly once/);
    }));
});

// ── log_edit ─────────────────────────────────────────────────────────────────

type EditRow = { actor: string; action: string; clip_id: string | null; before: unknown; after: unknown };
const editsFor = (tx: Tx, id: string) =>
  tx<EditRow[]>`select actor, action, clip_id, before, after from edits where inspection_id = ${id} order by id`;

describe("log_edit", () => {
  it("records a tech edit with before/after", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      await actor(tx, "ai");
      const lineId = await addLine(tx, id, 1);
      await actor(tx, "tech");
      await tx`update line_items set rating = 'monitor' where id = ${lineId}`;

      const edits = await editsFor(tx, id);
      expect(edits.map((e) => [e.actor, e.action])).toEqual([
        ["ai", "created"],
        ["tech", "updated"],
      ]);
      expect((edits[1].before as { rating: string }).rating).toBe("good");
      expect((edits[1].after as { rating: string }).rating).toBe("monitor");
    }));

  it("defaults to 'tech' when no actor is set", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      await addLine(tx, id, 1);
      expect((await editsFor(tx, id)).map((e) => e.actor)).toEqual(["tech"]);
    }));

  it("skips worker bookkeeping (status, path, cut_count) but logs a thumbnail change", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const lineId = await addLine(tx, id, 1);
      const { clipId, frameId } = await addClip(tx, id, lineId, 1, { ready: false });
      const before = (await editsFor(tx, id)).length;

      await tx`update clips set status = 'ready', path = 'x/c.mp4', cut_count = 1 where id = ${clipId}`;
      expect((await editsFor(tx, id)).length).toBe(before);

      await tx`update clips set thumbnail_frame_id = ${frameId} where id = ${clipId}`;
      const edits = await editsFor(tx, id);
      expect(edits.length).toBe(before + 1);
      expect(edits.at(-1)).toMatchObject({ action: "updated", clip_id: clipId });
    }));

  it("logs a line delete and the clips it cascades to", () =>
    inTx(async (tx) => {
      const id = await readyInspection(tx);
      const lineId = await addLine(tx, id, 1);
      const { clipId } = await addClip(tx, id, lineId, 1);
      await tx`delete from line_items where id = ${lineId}`;
      const deleted = (await editsFor(tx, id)).filter((e) => e.action === "deleted");
      expect(deleted.map((e) => e.clip_id).sort()).toEqual([clipId, null].sort());
    }));

  it("deleting a whole inspection works and leaves no edits behind", () =>
    inTx(async (tx) => {
      const s = await sendable(tx);
      await tx`delete from inspections where id = ${s.id}`;
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from edits where inspection_id = ${s.id}`;
      expect(n).toBe(0);
    }));

  it("deleting a SENT inspection cascades its report versions too (migration 0002)", () =>
    inTx(async (tx) => {
      const s = await sendable(tx);
      await send(tx, s.id);
      await send(tx, s.id);
      await tx`delete from inspections where id = ${s.id}`;
      const [counts] = await tx<{ versions: number; lines: number; clips: number; edits: number }[]>`
        select
          (select count(*)::int from report_versions where inspection_id = ${s.id}) as versions,
          (select count(*)::int from report_version_lines where source_line_id = ${s.lineId}) as lines,
          (select count(*)::int from report_version_clips where clip_path = ${`x/clips/${s.clipId}/1.mp4`}) as clips,
          (select count(*)::int from edits where inspection_id = ${s.id}) as edits`;
      expect(counts).toEqual({ versions: 0, lines: 0, clips: 0, edits: 0 });
    }));
});
