/**
 * Version diff for the customer page (plan §10 "/r/[token]"). Pure; safe in
 * client components.
 *
 * Lines are matched by `key`, the opaque per-report id that ShareResponse
 * derives from report_version_lines.source_line_id, so a line keeps its
 * identity across versions even when renamed or moved.
 */
import type { LineRating } from "../types/db";

export interface DiffableLine {
  key: string;
  component_name: string;
  note: string;
  rating: LineRating;
  clips: readonly unknown[];
}

/** What can change on a line, as the customer would notice it. */
export type LineField = "component_name" | "rating" | "note" | "clips";

export interface ChangedLine<T extends DiffableLine> {
  before: T;
  after: T;
  /** In display order: name, rating, note, clips. */
  fields: LineField[];
}

export interface VersionDiff<T extends DiffableLine> {
  /** In `current`'s order. */
  added: T[];
  /** In `current`'s order. */
  changed: ChangedLine<T>[];
  /** In `previous`'s order. */
  removed: T[];
}

/** Badge to show on a line of the current version. */
export type LineChangeBadge = "new" | "updated" | null;

/**
 * Compare two versions. Reordering alone is not a change.
 *
 * Clip changes are detected by count only: each version stores its own copy
 * of every clip, so a re-cut or a new thumbnail with the same number of clips
 * isn't visible here.
 */
export function diffVersions<T extends DiffableLine>(previous: readonly T[], current: readonly T[]): VersionDiff<T> {
  const prevByKey = new Map(previous.map((l) => [l.key, l]));
  const currKeys = new Set(current.map((l) => l.key));

  const added: T[] = [];
  const changed: ChangedLine<T>[] = [];
  for (const after of current) {
    const before = prevByKey.get(after.key);
    if (!before) {
      added.push(after);
      continue;
    }
    const fields = changedFields(before, after);
    if (fields.length > 0) changed.push({ before, after, fields });
  }
  const removed = previous.filter((l) => !currKeys.has(l.key));
  return { added, changed, removed };
}

function changedFields(a: DiffableLine, b: DiffableLine): LineField[] {
  const out: LineField[] = [];
  if (a.component_name.trim() !== b.component_name.trim()) out.push("component_name");
  if (a.rating !== b.rating) out.push("rating");
  if (a.note.trim() !== b.note.trim()) out.push("note");
  if (a.clips.length !== b.clips.length) out.push("clips");
  return out;
}

export function isEmptyDiff(d: VersionDiff<DiffableLine>): boolean {
  return d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0;
}

/** key -> badge for every line in the current version. */
export function changeBadges(d: VersionDiff<DiffableLine>): Map<string, LineChangeBadge> {
  const m = new Map<string, LineChangeBadge>();
  for (const l of d.added) m.set(l.key, "new");
  for (const c of d.changed) m.set(c.after.key, "updated");
  return m;
}
