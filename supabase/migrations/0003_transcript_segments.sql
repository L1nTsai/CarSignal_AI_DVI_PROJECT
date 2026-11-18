-- Full timed transcript of the narration (captions in the editor), written by
-- the AI step alongside the lines. Tech-only, like mentions.quote: never part
-- of a sent report. Replaced on every (re)process.
create table transcript_segments (
  id             uuid primary key default gen_random_uuid(),
  inspection_id  uuid not null references inspections(id) on delete cascade,
  start_ms       integer not null check (start_ms >= 0),   -- stitched timeline, when the words are spoken
  end_ms         integer not null,
  text           text not null check (btrim(text) <> ''),
  created_at     timestamptz not null default now(),
  check (end_ms > start_ms)
);
create index transcript_segments_inspection_idx on transcript_segments (inspection_id, start_ms);
