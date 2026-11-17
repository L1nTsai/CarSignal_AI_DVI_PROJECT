create extension if not exists pgcrypto with schema extensions;

-- ── Enums ────────────────────────────────────────────────────────────────────
create type inspection_status as enum ('recording','processing','ready_for_review','sent','failed');
create type processing_step   as enum ('converting','analyzing','cutting');          -- (drafted)
create type segment_status    as enum ('uploading','uploaded','failed');
create type line_rating       as enum ('good','monitor','needs_attention');
create type rating_basis      as enum ('stated','inferred');                          -- (drafted)
create type media_status      as enum ('pending','ready','failed');
create type frame_origin      as enum ('ai_candidate','tech_picked');
create type edit_action       as enum ('created','updated','deleted');
create type edit_actor        as enum ('ai','tech');
create type job_kind          as enum ('process_inspection','cut_clip','extract_frame');
create type job_status        as enum ('queued','running','succeeded','failed');

-- ── Shared updated_at trigger ────────────────────────────────────────────────
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ── inspections ──────────────────────────────────────────────────────────────
create table inspections (
  id               uuid primary key default gen_random_uuid(),
  customer_name    text     check (btrim(customer_name) <> ''),
  vehicle_year     smallint check (vehicle_year between 1900 and 2100),
  vehicle_make     text     check (btrim(vehicle_make) <> ''),
  vehicle_model    text     check (btrim(vehicle_model) <> ''),
  vin              text     check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),   -- app uppercases before saving
  status           inspection_status not null default 'recording',
  processing_step  processing_step,
  failure_reason   text,
  video_path       text,                                             -- stitched, normalized video
  duration_ms      integer  check (duration_ms > 0 and duration_ms <= 600000),
  share_token      text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint processing_step_iff_processing check ((status = 'processing') = (processing_step is not null)),
  constraint failure_reason_iff_failed      check ((status = 'failed') = (failure_reason is not null)),
  constraint share_token_iff_sent           check ((status = 'sent') = (share_token is not null)),
  constraint video_present_when_ready       check (status not in ('ready_for_review','sent')
                                                   or (video_path is not null and duration_ms is not null)),
  constraint details_present_when_sent      check (status <> 'sent' or (
                                                   customer_name is not null and vehicle_year is not null and
                                                   vehicle_make is not null and vehicle_model is not null and
                                                   vin is not null))
);
create index inspections_created_at_idx on inspections (created_at desc);
create trigger inspections_updated_at before update on inspections
  for each row execute function set_updated_at();

-- ── video_segments: the recorded pieces (one per pause) ──────────────────────
create table video_segments (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references inspections(id) on delete cascade,
  segment_number  integer not null check (segment_number >= 1),
  status          segment_status not null default 'uploading',
  original_path   text not null unique,
  mime_type       text not null,
  duration_ms     integer check (duration_ms > 0),        -- set by worker
  offset_ms       integer check (offset_ms >= 0),         -- start on the stitched timeline; set by worker
  created_at      timestamptz not null default now(),
  unique (inspection_id, segment_number),
  check ((duration_ms is null) = (offset_ms is null))
);

-- ── line_items: the live, editable lines ─────────────────────────────────────
create table line_items (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references inspections(id) on delete cascade,
  position        integer not null check (position >= 1),
  component_name  text not null check (btrim(component_name) <> ''),
  note            text not null,                            -- may be '' while editing; Send requires non-empty
  rating          line_rating not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint line_items_position_key unique (inspection_id, position) deferrable initially deferred,
  constraint line_items_id_inspection_key unique (id, inspection_id)   -- target for clips' composite FK
);
create trigger line_items_updated_at before update on line_items
  for each row execute function set_updated_at();

-- ── ai_suggestions: what the AI said; never edited. No row = tech-added line ─
create table ai_suggestions (
  line_item_id    uuid primary key references line_items(id) on delete cascade,
  component_name  text not null,
  note            text not null,
  rating          line_rating not null,
  rating_basis    rating_basis not null,
  model           text not null,
  created_at      timestamptz not null default now()
);

-- ── mentions: AI evidence — each time the part came up ───────────────────────
create table mentions (
  id                uuid primary key default gen_random_uuid(),
  line_item_id      uuid not null references line_items(id) on delete cascade,
  visible_start_ms  integer not null check (visible_start_ms >= 0),   -- stitched timeline
  visible_end_ms    integer not null,
  best_frame_ms     integer not null,
  quote             text not null check (btrim(quote) <> ''),          -- verbatim narration; tech-only
  created_at        timestamptz not null default now(),
  check (visible_end_ms > visible_start_ms),
  check (best_frame_ms between visible_start_ms and visible_end_ms)
);
create index mentions_line_item_id_idx on mentions (line_item_id);

-- ── clips: what the customer watches ─────────────────────────────────────────
create table clips (
  id                  uuid primary key default gen_random_uuid(),
  inspection_id       uuid not null,
  line_item_id        uuid not null,
  mention_id          uuid references mentions(id) on delete set null,   -- null = added by tech
  position            integer not null check (position >= 1),            -- 1 = main clip
  start_ms            integer not null check (start_ms >= 0),            -- stitched timeline
  end_ms              integer not null,
  status              media_status not null default 'pending',
  path                text,                -- current cut; never overwritten (new file per cut)
  cut_count           integer not null default 0 check (cut_count >= 0),
  thumbnail_frame_id  uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (line_item_id, inspection_id) references line_items (id, inspection_id) on delete cascade,
  check (end_ms > start_ms),
  check (end_ms - start_ms <= 60000),
  check (status <> 'ready' or path is not null),
  constraint clips_position_key unique (line_item_id, position) deferrable initially deferred
);
create index clips_inspection_id_idx on clips (inspection_id);
create index clips_mention_id_idx on clips (mention_id);
create trigger clips_updated_at before update on clips
  for each row execute function set_updated_at();

-- ── frames: candidate + tech-picked photos, belonging to a clip ──────────────
create table frames (
  id            uuid primary key default gen_random_uuid(),
  clip_id       uuid not null references clips(id) on delete cascade,
  timestamp_ms  integer not null check (timestamp_ms >= 0),     -- stitched timeline
  storage_path  text not null unique,
  origin        frame_origin not null,
  sharpness     real not null check (sharpness >= 0),
  created_at    timestamptz not null default now(),
  unique (clip_id, id)
);
-- A clip's thumbnail must be one of ITS frames. NO ACTION (default) on purpose:
-- it is checked at end of statement, so cascading a clip delete works.
alter table clips add constraint clips_thumbnail_belongs_to_clip
  foreign key (id, thumbnail_frame_id) references frames (clip_id, id);

-- ── report_versions: one per Send (frozen) ───────────────────────────────────
create table report_versions (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references inspections(id) on delete restrict,
  version_number  integer not null check (version_number >= 1),
  customer_name   text not null,
  vehicle_year    smallint not null,
  vehicle_make    text not null,
  vehicle_model   text not null,
  vin             text not null,
  sent_at         timestamptz not null default now(),
  unique (inspection_id, version_number)
);

create table report_version_lines (
  id                 uuid primary key default gen_random_uuid(),
  report_version_id  uuid not null references report_versions(id) on delete cascade,
  source_line_id     uuid not null,   -- deliberately NO FK: history must outlive deleted lines; used for diffs
  position           integer not null,
  component_name     text not null,
  note               text not null,
  rating             line_rating not null,
  unique (report_version_id, position),
  unique (report_version_id, source_line_id)
);

create table report_version_clips (
  id                      uuid primary key default gen_random_uuid(),
  report_version_line_id  uuid not null references report_version_lines(id) on delete cascade,
  position                integer not null,
  clip_path               text not null,
  thumbnail_path          text not null,
  unique (report_version_line_id, position)
);

-- ── edits: append-only log of every change to lines and clips ────────────────
create table edits (
  id             bigint generated always as identity primary key,
  inspection_id  uuid not null references inspections(id) on delete cascade,
  line_item_id   uuid not null,      -- no FK on purpose (history outlives deletes)
  clip_id        uuid,               -- no FK on purpose; null = edit to the line itself
  action         edit_action not null,
  actor          edit_actor not null,
  before         jsonb,
  after          jsonb,
  created_at     timestamptz not null default now(),
  check (
    (action = 'created' and before is null     and after is not null) or
    (action = 'updated' and before is not null and after is not null) or
    (action = 'deleted' and before is not null and after is null)
  )
);
create index edits_inspection_created_idx on edits (inspection_id, created_at);

-- Actor comes from a transaction-local setting; default is 'tech'.
-- The worker runs `select set_config('app.actor', 'ai', true)` in its transactions.
create function log_edit() returns trigger language plpgsql as $$
declare
  v_actor      edit_actor := coalesce(nullif(current_setting('app.actor', true), ''), 'tech')::edit_actor;
  v_before     jsonb;
  v_after      jsonb;
  v_row        jsonb;
  v_keys       text[];
  v_inspection uuid;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old); v_after := to_jsonb(new);
  else
    v_before := to_jsonb(old);
  end if;
  v_row := coalesce(v_after, v_before);
  v_inspection := (v_row->>'inspection_id')::uuid;

  -- Whole inspection is being deleted (cascade): nothing to log.
  if not exists (select 1 from inspections where id = v_inspection) then
    return null;
  end if;

  -- Only log changes to user-meaningful fields (skip worker bookkeeping like status/path).
  if tg_table_name = 'line_items' then
    v_keys := array['component_name','note','rating','position'];
  else
    v_keys := array['start_ms','end_ms','position','thumbnail_frame_id'];
  end if;
  if tg_op = 'UPDATE' and not exists (
       select 1 from unnest(v_keys) k where v_before->k is distinct from v_after->k) then
    return null;
  end if;

  insert into edits (inspection_id, line_item_id, clip_id, action, actor, before, after)
  values (
    v_inspection,
    case when tg_table_name = 'line_items' then (v_row->>'id')::uuid else (v_row->>'line_item_id')::uuid end,
    case when tg_table_name = 'clips'      then (v_row->>'id')::uuid end,
    (case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end)::edit_action,
    v_actor, v_before, v_after
  );
  return null;
end $$;
-- Test the cascade path: deleting a whole inspection must not fail or leave edits behind.

create trigger line_items_log_edit after insert or update or delete on line_items
  for each row execute function log_edit();
create trigger clips_log_edit after insert or update or delete on clips
  for each row execute function log_edit();

-- ── jobs: the worker's queue ─────────────────────────────────────────────────
create table jobs (
  id                  bigint generated always as identity primary key,
  inspection_id       uuid not null references inspections(id) on delete cascade,
  clip_id             uuid references clips(id) on delete cascade,
  kind                job_kind not null,
  frame_timestamp_ms  integer check (frame_timestamp_ms >= 0),
  status              job_status not null default 'queued',
  attempts            integer not null default 0 check (attempts >= 0),
  last_error          text,
  run_after           timestamptz not null default now(),
  locked_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((kind = 'process_inspection') = (clip_id is null)),
  check ((kind = 'extract_frame') = (frame_timestamp_ms is not null)),
  check ((status = 'running') = (locked_at is not null))
);
create index jobs_queued_idx on jobs (run_after) where status = 'queued';
create index jobs_clip_id_idx on jobs (clip_id);
create unique index jobs_one_active_process on jobs (inspection_id)
  where kind = 'process_inspection' and status in ('queued','running');
create unique index jobs_one_queued_cut on jobs (clip_id)
  where kind = 'cut_clip' and status = 'queued';      -- a running cut + one queued re-cut is fine
create trigger jobs_updated_at before update on jobs
  for each row execute function set_updated_at();

-- Claim one job. FOR UPDATE SKIP LOCKED: a job is never run twice concurrently.
create function claim_job() returns setof jobs language sql as $$
  update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
  where id = (
    select id from jobs
    where status = 'queued' and run_after <= now()
    order by run_after, id
    for update skip locked
    limit 1
  )
  returning *;
$$;

-- Reorder lines in one transaction (position constraint is checked at commit).
create function reorder_lines(p_inspection_id uuid, p_ids uuid[]) returns void language plpgsql as $$
begin
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or cardinality(p_ids) <> (select count(*) from line_items where inspection_id = p_inspection_id)
     or exists (select 1 from unnest(p_ids) x(id)
                where not exists (select 1 from line_items where id = x.id and inspection_id = p_inspection_id)) then
    raise exception 'p_ids must list every line of the inspection exactly once';
  end if;
  update line_items li set position = o.ord
  from unnest(p_ids) with ordinality as o(id, ord)
  where li.id = o.id;
end $$;
-- Same pattern for the clips of one line.
create function reorder_clips(p_line_item_id uuid, p_ids uuid[]) returns void language plpgsql as $$
begin
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or cardinality(p_ids) <> (select count(*) from clips where line_item_id = p_line_item_id)
     or exists (select 1 from unnest(p_ids) x(id)
                where not exists (select 1 from clips where id = x.id and line_item_id = p_line_item_id)) then
    raise exception 'p_ids must list every clip of the line exactly once';
  end if;
  update clips c set position = o.ord
  from unnest(p_ids) with ordinality as o(id, ord)
  where c.id = o.id;
end $$;

-- Send / Send update: all checks + frozen copy + share token, in ONE transaction.
create function send_report(p_inspection_id uuid) returns text language plpgsql as $$
declare
  v_insp            inspections;
  v_version_id      uuid;
  v_version_number  integer;
  v_problem         text;
begin
  select * into v_insp from inspections where id = p_inspection_id for update;
  if not found then raise exception 'inspection not found'; end if;
  if v_insp.status not in ('ready_for_review','sent') then
    raise exception 'inspection is not ready to send (status %)', v_insp.status;
  end if;
  if v_insp.customer_name is null or v_insp.vehicle_year is null or v_insp.vehicle_make is null
     or v_insp.vehicle_model is null or v_insp.vin is null then
    raise exception 'customer and vehicle details are incomplete';
  end if;
  if not exists (select 1 from line_items where inspection_id = p_inspection_id) then
    raise exception 'report has no lines';
  end if;
  select li.component_name into v_problem
  from line_items li
  where li.inspection_id = p_inspection_id
    and ( btrim(li.note) = ''
       or not exists (select 1 from clips c where c.line_item_id = li.id)
       or exists (select 1 from clips c where c.line_item_id = li.id
                  and (c.status <> 'ready' or c.thumbnail_frame_id is null)) )
  limit 1;
  if v_problem is not null then
    raise exception 'line "%" needs a note and at least one ready clip with a thumbnail', v_problem;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version_number
  from report_versions where inspection_id = p_inspection_id;

  insert into report_versions (inspection_id, version_number, customer_name, vehicle_year,
                               vehicle_make, vehicle_model, vin)
  values (p_inspection_id, v_version_number, v_insp.customer_name, v_insp.vehicle_year,
          v_insp.vehicle_make, v_insp.vehicle_model, v_insp.vin)
  returning id into v_version_id;

  with lines as (
    insert into report_version_lines (report_version_id, source_line_id, position, component_name, note, rating)
    select v_version_id, li.id, li.position, li.component_name, li.note, li.rating
    from line_items li where li.inspection_id = p_inspection_id
    returning id, source_line_id
  )
  insert into report_version_clips (report_version_line_id, position, clip_path, thumbnail_path)
  select l.id, c.position, c.path, f.storage_path
  from lines l
  join clips  c on c.line_item_id = l.source_line_id
  join frames f on f.id = c.thumbnail_frame_id;

  update inspections
  set status = 'sent',
      share_token = coalesce(share_token,
                    translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'))
  where id = p_inspection_id;

  return (select share_token from inspections where id = p_inspection_id);
end $$;
