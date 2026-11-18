# CarSignal AI DVI: Build Plan

Handoff spec for Claude Code, written from a planning session with the project owner on 2026-11-16.

- Sections marked **(drafted)** were written by Claude after the session, based on the agreed decisions. The owner hasn't reviewed them line by line yet.
- Everything else was decided explicitly with the owner.
- **If something isn't covered here, ask the owner. Don't assume.** Section 16 lists questions that are still open.

---

## 1. What we're building

CarSignal helps independent auto repair shops manage repairs and talk to customers. A technician records a narrated video walkaround of a vehicle on their phone. The app turns that video into a **Digital Vehicle Inspection (DVI)**:

- one line per inspected component,
- each line has a name, an observation note and a rating (**Good / Monitor / Needs attention**),
- each line has matching photos and short playable clips cut from the video.

The tech reviews and edits the result, then sends the customer a read-only link.

### Requirements from the take-home brief

1. **Record and upload.** Record a narrated inspection and upload it to the app.
2. **Generate DVI line items.** One line per inspected component, with name, observation note and suggested rating: Good, Monitor or Needs attention.
3. **Attach matching media.** Extract still frames and short playable clips from the original video, and assign them to the matching line automatically.
4. **Display each line.** Show name, note and rating, with that line's photos and clips directly in or beneath it. The page must be readable on a phone.
5. **Grounding rule.** Use only the technician's observations. Never add measurements, diagnoses or repair recommendations that weren't stated.
6. **Submission.** Code, setup instructions, and a demo using the owner's own recorded inspection.

The brief's examples:

- **Left front tire.** The tech shows the tire and says "The inner edge is worn. Mark it needs attention." Result: a *Left front tire* line, rated Needs attention, with a note about the wear and the matching tire photo and clip beneath it.
- **Wipers.** In the same video, the tech shows the wipers and says "These look good." Result: a separate *Wipers* line, rated Good, with its own photo and clip.

---

## 2. Decisions log

| Area | Decision |
|---|---|
| Timeline | A take-home with no hard deadline. The goal is a good, working application. |
| App | One responsive **Next.js + TypeScript** web app for both phone and laptop. No native or desktop app. |
| Phone vs laptop | The phone can do everything on its own. The laptop is optional: it pairs through a QR code and shows each recorded part once it's uploaded. There is **no** live camera view. |
| Recording | A **custom in-browser recorder** with no file upload path. Rear camera, about 720p, prefers MP4/H.264. Includes **Pause** and **Retake**, where Retake redoes only the part since the last pause. |
| Segments | Each pause ends a recording piece behind the scenes. The worker **stitches** all pieces into one video before the AI step. The total cap is **10 minutes**. All pieces must be recorded before processing starts; nothing can be added afterwards. |
| Backend | **Supabase running locally** (Postgres + Storage). |
| Worker | A **local Node + ffmpeg** process. |
| HTTPS | A **tunnel** (Cloudflare Tunnel or ngrok). It's needed so the phone camera works, and it makes the customer link reachable. |
| Auth | **None for now.** |
| AI | **Gemini Flash** for everything: transcription, splitting into lines, ratings, timestamps and frame choice. One call per inspection. The model name is a config value so Pro can be tried later. Claude is **not** used. |
| Grounding | Every line keeps **exact narration quotes**, which only the tech sees. The **customer sees the cleaned-up note**, which must never add anything that wasn't said. |
| Clip timing | The AI returns when the part is on camera. Each clip pads that by **±3–4 s**, splits overlaps with neighbouring parts at the midpoint, never crosses a pause point, and is capped in length. |
| Thumbnails | Gemini picks the moment. The worker takes about 5 frames around it and keeps the sharpest; the others become candidates in the editor. |
| One line per part | If a part is mentioned in several places, Gemini merges the mentions into **one line**. |
| Media per line | **Several clips per line, each with its own thumbnail** (option "B"). Clip #1 is the main clip, and its thumbnail is the line's photo. With a single mention, a line looks exactly like the brief's examples. |
| Manual mode | The tech can change **everything**: name, note, rating, clip start/end, thumbnail, adding/removing/reordering clips, adding/deleting/reordering lines. The AI's original values are kept. |
| Customer and vehicle fields | customer name, vehicle year, make, model, VIN. Entered **in the editor**. **All required before sending.** |
| Sending | The tech reviews, then hits **Send to customer**. Each Send creates a **frozen version**. The customer sees the latest version, with "Updated" badges and access to older versions. Edits after sending become visible only after **Send update**. |
| Edit history | Every save by the tech to lines and clips is logged in an append-only table that's internal only. Customer/vehicle detail saves are **not** logged there (confirmed 2026-11-17); "unsent changes" catches them by comparing with the last sent version's copy. |
| Customer page | A summary at the top (counts by rating), then lines **grouped by rating, Needs attention first**, keeping the tech's order within each group. Shows name, rating, note, photos and clips. No quotes, no edit controls, no AI internals. |
| Customer approval | **Out of scope.** |
| Home page | A basic list of inspections at `/`. |
| Orientation | **Either, whichever the technician prefers.** The recorder and the tips don't steer it, and the pipeline and players must handle portrait, landscape, and a switch partway through. The camera opens in the shape the phone is held (tall when upright), and the recorder re-checks it because iOS sometimes hands back the wrong shape (see section 6). |
| Deleting inspections | Allowed from the home list for any inspection that isn't processing, **including sent ones** (changed 2026-11-17; migration `0002`). Deleting a sent inspection deletes its sent versions too, so the customer link stops working; the confirm says so. |
| Re-process | A **development-only** button that re-runs the AI on an existing recording without recording again. It replaces all lines. |
| Clip drawings | The tech can **draw on a clip** (freehand pen, red / yellow / white). Each drawing starts at the playhead and shows for a few seconds (default 3 s, 1–10 s). They're stored as data (`clips.annotations`, migration `0005`) and drawn **as an overlay** on the customer's player, not burned into the mp4, so editing one never re-cuts. Thumbnails are never drawn on. Decided 2026-11-17. |
| Car diagram | The customer page shows a **top-down car** with each issue's spot tinted by rating (worst per spot) and the playing issue outlined; tap a spot to play it. Gemini picks each line's zone (`car_zone`, `lib/carZones.ts`; "left" is the driver's side), the tech can change it, and each sent version freezes it (migration `0006`). Decided 2026-11-17. |
| Recording check | Each uploaded piece is checked: if its picture ends well before its sound, the tech is told which part froze and when, and Finish asks before going ahead (migration `0007`). Decided 2026-11-17. |
| Every line needs media | A line can't be sent unless it has **at least one ready clip** with a thumbnail. |
| Known risk: iPhone recording | There's an open WebKit bug about iOS MediaRecorder corrupting files. **It happened** (2026-11-17): on an iPhone, three recordings stopped writing video 10–17 s in while the sound kept going, so the stitched video froze on its last frame. The owner then approved the mitigations in section 6 (camera watchdog, automatic restart of a stalled take, server check of each piece, Finish blocked on a flagged piece unless the tech chooses to go ahead). **Any further workaround for recording problems still needs the owner's say-so.** |

---

## 3. Architecture

```
  Phone / laptop browser
          │  https (Cloudflare Tunnel or ngrok)  — the only exposed service
          ▼
  Next.js app (pages + route handlers) ─────────►  Supabase (local, Docker)
          ▲                                          • Postgres: data + job queue
          │ polling every ~2 s                       • Storage: videos, clips, frames
          │                                                 ▲
          │                                                 │
          └──────────────── Worker (Node + ffmpeg) ─────────┘
                                   │
                                   ▼
                            Gemini API (Flash)
```

**Only Next.js goes through the tunnel. (drafted)** The browser never talks to Supabase directly. This gives:

- one public origin, so there are no mixed-content problems;
- the Supabase service-role key stays on the server;
- no row-level security setup is needed while there's no auth.

Because Supabase isn't reachable from the browser, **live updates use polling** (SWR or React Query, about every 2 s while something is in progress) instead of Supabase Realtime.

### Repo layout (drafted)

```
/app          Next.js App Router pages + route handlers (/app/api/...)
/components   UI components
/lib          db client, storage client, shared types, pure logic:
              clip ranges, grounding check, version diff, Gemini output validation
/worker       worker entry point + one handler per job kind
/supabase     config.toml, migrations/, seed.sql
```

Use one `package.json` with these scripts: `dev`, `worker`, `dev:all` (runs both via `concurrently`), `test`.

### Data access (drafted)

- **DB:** the `postgres` npm client, connecting straight to the local Supabase Postgres, in both route handlers and the worker. This gives real transactions and `set_config` (used by the audit trigger).
- **Storage:** `@supabase/supabase-js` with the service-role key, server-side only.
- **Never** send the service-role key or the DB URL to the browser.

---

## 4. Data model

All IDs are `uuid` (`gen_random_uuid()`), except the append-only tables, which use `bigint identity`. All times are `timestamptz`. Invariants are enforced in the database wherever possible.

### Migration `supabase/migrations/0001_init.sql`

This migration was checked against Postgres 16, with an `extensions` schema created to match Supabase. A smoke test confirmed:

- AI results insert correctly, and Send is blocked while details are missing.
- Reorder, `send_report` versions 1 and 2, and the frozen copies all work.
- The edit log records the right actor, and worker bookkeeping isn't logged.
- The VIN, clip-range, thumbnail-ownership and same-inspection checks reject bad data.
- Deleting an inspection cascades with no leftover edits; for a sent one, its report versions cascade too (`0002`).
- Only one active process job is allowed per inspection, and `claim_job` works.

```sql
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
-- Same pattern: reorder_clips(p_line_item_id uuid, p_ids uuid[]).

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
```

### Seed `supabase/seed.sql`

```sql
insert into storage.buckets (id, name, public) values ('inspection-media', 'inspection-media', false)
on conflict (id) do nothing;
```

### Rules the database enforces

- Customer and vehicle fields are optional until the inspection is `sent`, then all five are required.
- `share_token` exists if and only if the inspection has been sent. It's a random 32-character URL-safe string. **It's separate from the inspection id**, which works as the edit URL because there's no auth.
- A clip's thumbnail must be a frame of that same clip.
- A clip must belong to a line of the same inspection (composite foreign key).
- A clip can't be marked `ready` without a file path.
- Clips are 60 s at most when set manually. Clips from the AI are capped lower by the worker.
- Send fails, and nothing is saved, if any line has an empty note, no clips, a clip that isn't ready, or a clip without a thumbnail.
- History tables (`report_version_*`, `edits`) intentionally have **no foreign keys** to live lines or clips, so they survive deletes.

### Migration `0005_clip_annotations.sql` (clip drawings)

- `clips.annotations jsonb not null default '[]'`: an array, at most 256 KB. Shape (validated by
  `lib/annotations.ts#annotationsSchema`): `{ id, start_ms, end_ms, strokes: [{ color, points: [[x, y], ...] }] }[]`.
  Times are on the **stitched timeline** like the clip's range, so a range change doesn't move a drawing; drawings
  outside the range are kept but hidden. `x, y` are 0..1 over the full frame (every piece is padded to one frame
  size, so the coordinates fit the stitched video and every clip).
- `log_edit` also watches `annotations`, so a drawing is a tech edit and counts as an unsent change.
- `report_version_clips` gains `clip_start_ms`, `clip_end_ms` and `annotations`; `send_report` copies them. The share
  query converts to clip time (`toClipTime`) and drops the ids. Versions sent before `0005` have no range and no drawings.

### Migration `0006_car_zones.sql` (car diagram)

- `line_items.car_zone`, `ai_suggestions.car_zone` and `report_version_lines.car_zone`: nullable text, checked
  against the keys in `lib/carZones.ts#CAR_ZONE_KEYS` (keep both lists in step). null = not on the car.
- `log_edit` also watches `car_zone` (a zone change is a tech edit and an unsent change); `send_report` copies it.
- The worker stores the AI's zone, or `guessZone(component_name)` when the AI said "none". A tech-added line without
  a zone gets the same guess. Versions sent before `0006` get the guess at read time.

### Migration `0007_segment_video_check.sql` (recording check)

- `video_segments.video_cut_at_ms integer check (>= 0)`: where, on the piece's own timeline, the picture stopped while
  the sound kept going. null = fine, or not checked (pieces from before `0007`, or the probe failed). Set by the
  segments route after the upload (`lib/segmentCheck.ts`); never read by the worker or the customer page.

### Derived values (not stored)

- **Line source:** a line is AI-created if an `ai_suggestions` row exists, otherwise tech-created.
- **Line photo:** the thumbnail of clip `position = 1`.
- **Unsent changes** (when status is `sent`): true if any `edits` row with `actor='tech'` is newer than the latest `report_versions.sent_at`, **or** the inspection's customer/vehicle fields differ from that version's copy.

---

## 5. Storage layout

All files go in one **private** bucket, `inspection-media`. Files are **never overwritten**, so older versions keep working.

```
{inspection_id}/segments/{segment_number}/original.{mp4|webm}
{inspection_id}/stitched.mp4
{inspection_id}/clips/{clip_id}/{cut_count}.mp4
{inspection_id}/frames/{frame_id}.jpg
```

- Raise the local upload limit in `supabase/config.toml`: `[storage] file_size_limit = "1GiB"`.
- **Serving media (drafted):** browsers can't reach Supabase, so `GET /api/media/[...path]` proxies files from Storage. It must **forward the `Range` header and return `206 Partial Content`**, otherwise video seeking breaks, especially on iOS. Fetch from the Storage REST endpoint with the service-role key (`{SUPABASE_URL}/storage/v1/object/authenticated/inspection-media/{path}`) and pass the status, `Content-Range`, `Accept-Ranges`, `Content-Length` and `Content-Type` through.

---

## 6. Recording (phone)

**Page:** `/inspections/[id]/record`

**Tips overlay.** Shown before the first recording, with a "Don't show again" option stored in `localStorage` (wrap in try/catch). Tips:

- Name the part out loud, then show it.
- Say the condition: good, monitor, or needs attention.
- Hold the camera on each part for 2–3 seconds.
- Do one part at a time.

While recording, keep a one-line reminder on screen: *Name it → show it → say the condition.*

Don't tell the tech which way to hold the phone. Portrait and landscape are both fine.

**Camera.**

```js
getUserMedia({
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  audio: true
})
```

This requires HTTPS, which the tunnel provides.

The recorder asks for a tall picture (720×1280) when the phone is upright and a wide one when it's on its side.
iOS Safari doesn't always honor that (an upright iPhone handed back a wide picture), so `openCamera` checks the shape
it got and, if it's wrong, asks again with the sizes swapped, then with no size; if nothing matches it keeps the
normal request. Once a part is recorded the orientation is locked, so every part matches.

**Format.** Pick the first value that `MediaRecorder.isTypeSupported` accepts:

1. `video/mp4;codecs=avc1,mp4a.40.2`
2. `video/mp4`
3. `video/webm;codecs=vp9,opus`
4. `video/webm`

Use `videoBitsPerSecond: 2_500_000`. The worker converts everything anyway, so this list only keeps files small and consistent.

**Pause is a hidden segment break. Don't use `MediaRecorder.pause()`.**

- **Pause** = `recorder.stop()`. The resulting blob becomes the next segment and starts uploading immediately.
- **Resume** = a new `MediaRecorder` on the same stream.
- The tech only ever sees Pause and Resume, never the word "segment."

**Retake** discards the part since the last pause:

- If the tech is recording, stop and throw that piece away.
- If the tech is paused, delete the last uploaded piece with `DELETE /api/inspections/[id]/segments/[n]`.

Then record a replacement.

**Controls.**

- While recording: **Pause**, **Retake part**.
- While paused: **Resume**, **Retake last part**, **Finish**.
- A running timer shows total length and stops at the **10-minute cap**.

**Robustness.**

- Ask for a screen Wake Lock while recording (in try/catch).
- If the page becomes hidden while recording, treat it as Pause so the recorded piece is saved.
- **Camera watchdog.** iOS can take the camera away from Safari mid-take (Control Center, flashlight, a call
  banner, heat) while the microphone keeps going; the piece then freezes on its last frame. While recording, if the
  video track mutes or the preview gets no new frame for 1.5 s (`requestVideoFrameCallback`), stop the take (keep it),
  reopen the camera and tell the tech to Resume.
- **Recorder watchdog.** Safari's MediaRecorder can stop writing video while the camera and sound carry on (seen on
  iPhone at 10 s and 17 s in). The recorder collects data every 500 ms (`rec.start(500)`); if the last 2 s brought
  data but under 70 KB (sound only; working video is 220–340 KB/s, `recorderStalled`), it ends the take and starts a
  new one on the same camera by itself, with a short notice. A third stall within 30 s falls back to the camera
  watchdog's pause + reopen.
- **Upload check.** After storing a piece, the segments route probes it with ffprobe (`lib/segmentCheck.ts`). If the
  picture ends more than 3.5 s before the sound (a packet counts for at most 0.5 s: Safari stretches the last frame
  over the rest of the take), it saves `video_segments.video_cut_at_ms` (migration `0007`) and returns
  it. The parts strip marks that part ("Video froze at 0:17"), and Finish returns 409 `video_cut` until the tech
  retakes it or taps **Finish anyway** (`{ allow_video_cut: true }`). A failed probe never fails the upload.

**Upload.** Send each piece with `POST /api/inspections/[id]/segments?n={number}`, with the raw blob as the body and its MIME type as `content-type`.

- Uploads go one at a time, with up to 3 retries.
- Show the upload state for each piece.

**Finish.**

1. Wait for all pending uploads, with a visible progress indicator.
2. Call `POST /api/inspections/[id]/finish`.
3. Go to `/inspections/[id]`.

---

## 7. Processing pipeline: worker (drafted)

The worker is a Node process (`npm run worker`).

- **Loop:** call `claim_job()`. When there's nothing to claim, sleep 1 s. Run one job at a time.
- **On startup:** set `running` jobs whose `locked_at` is older than 10 minutes back to `queued`, because a crash leaves them stuck.
- **On failure:** retry with backoff (`run_after = now() + attempts * 30s`) up to 3 attempts, then mark the job `failed` and record `last_error`.
- **Whenever a job leaves `running`** (succeeded, failed or re-queued), set `locked_at = null` in the same update. A check constraint requires this.
- **ffmpeg / ffprobe** run through `child_process.spawn`, in a temporary directory per job.

### `process_inspection`

If the inspection already has a `video_path` (a re-process), skip step 1 and start at step 2.

**1. Converting** (`processing_step = 'converting'`)

- Download every segment and get its duration with ffprobe.
- Convert each piece to the same format so they can be joined:

  ```
  ffmpeg -i in -vf "scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,fps=30" \
         -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
         -c:a aac -ar 48000 -ac 1 -b:a 96k -movflags +faststart piece_n.mp4
  ```

  Choose W×H from the **first** piece's orientation after rotation: 1280×720 for landscape, 720×1280 for portrait. Later pieces in the other orientation get padded. The tech may hold the phone either way, so this must handle a switch between pieces.
- Join the pieces with the concat demuxer (`-c copy`) into `stitched.mp4`, then upload it.
- Save each segment's `duration_ms` and `offset_ms`, plus the inspection's `video_path` and `duration_ms`.

**2. Analyzing** (`processing_step = 'analyzing'`)

- Run the Gemini call from section 8.
- Validate and repair its output (section 8).
- Run the grounding check (section 9).

**3. Saving results.** One transaction, with `set_config('app.actor','ai',true)`:

- Delete any lines that already exist for this inspection, left over from a crashed attempt or replaced by a re-process.
- Insert `line_items` with positions in order of first appearance.
- Insert `ai_suggestions` and `mentions`.
- Insert one `clips` row per mention, `status='pending'`, with ranges from section 9. Number clips per line in order of appearance.
- Set `processing_step = 'cutting'`.
- Insert one `cut_clip` job per clip.

**4. On final failure:** set `status='failed'` and a readable `failure_reason`. The UI shows a **Retry** button that calls `POST /api/inspections/[id]/retry`.

### `cut_clip`

1. Read the clip's **current** `start_ms` and `end_ms`. The tech may have changed them after the job was queued.
2. Cut the clip:

   ```
   ffmpeg -ss {start} -i stitched.mp4 -t {dur} -c:v libx264 -preset veryfast -crf 23 \
          -c:a aac -movflags +faststart {cut_count+1}.mp4
   ```

3. Upload to `{inspection}/clips/{clip_id}/{cut_count+1}.mp4`.
4. **Candidate frames:**
   - AI clips: about 5 frames at `best_frame_ms` −1000, −500, 0, +500, +1000 ms, kept inside the clip.
   - Tech-added clips: 5 frames evenly spaced through the clip.
   - Extract each with `ffmpeg -ss {t} -i stitched.mp4 -frames:v 1 -q:v 3 f.jpg`.
   - Score sharpness as the **variance of the Laplacian** on a grayscale image downscaled to 640 px wide, using `sharp` (`convolve` with a Laplacian kernel, then `stats()`).
   - Upload the frames and insert `frames` rows with `origin='ai_candidate'`.
5. **Thumbnail:** if the clip has none, or the current one falls outside the new range, set it to the sharpest new frame.
6. Set `status='ready'`, `path`, and `cut_count += 1`.
7. If the inspection is `processing` and none of its clips are `pending`, set `status='ready_for_review'` and clear `processing_step`.
8. **On final failure:** set the clip to `status='failed'`. The editor shows it with a retry action, and the inspection can still reach `ready_for_review`.

### `extract_frame`

1. Extract the frame at `frame_timestamp_ms` and score its sharpness.
2. Insert a `frames` row with `origin='tech_picked'`.
3. Make it the clip's thumbnail.

---

## 8. Gemini call (drafted)

**SDK.** Use `@google/genai`. Verify the exact API shape against the current SDK docs.

```ts
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
let file = await ai.files.upload({ file: stitchedPath, config: { mimeType: 'video/mp4' } });
while (file.state === 'PROCESSING') { await sleep(2000); file = await ai.files.get({ name: file.name! }); }
if (file.state !== 'ACTIVE') throw new Error('Gemini file processing failed');

const res = await ai.models.generateContent({
  model: process.env.GEMINI_MODEL!,              // e.g. a current Flash model id — check Google's model list
  contents: [createPartFromUri(file.uri!, file.mimeType!), prompt],
  config: { responseMimeType: 'application/json', responseSchema },
});
const raw = JSON.parse(res.text!);
await ai.files.delete({ name: file.name! });
```

- Leave temperature at the model's default unless testing shows a reason to change it.
- Gemini samples video at **1 frame per second** by default, so its timestamps are only accurate to about a second. The padding and manual mode absorb that.
- If timing turns out poorly, try raising the sampling rate through the video part's `videoMetadata.fps`. That costs proportionally more tokens.

**Cost.** Roughly 300 tokens per second of video. A 3-minute inspection is about 54k input tokens, which costs a few cents on Flash.

### Prompt

```
You are turning a car technician's narrated inspection video into digital vehicle inspection (DVI) line items.

The video is {DURATION_MMSS} long. It was recorded in {N} parts that were joined together; the parts start at
{PART_STARTS_MMSS}. The jumps at those times are cuts, not continuous footage.

Create one line for each distinct vehicle component the technician inspects out loud. If the same component
comes up more than once, create ONE line and list every mention.

For each line:
- component_name: the component as the technician named it. Short, Title Case, include position
  (e.g. "Left Front Tire", "Wipers", "Engine Air Filter").
- rating: good, monitor, or needs_attention.
  - If the technician states a rating ("mark it needs attention", "put it on monitor"), use it. rating_basis = "stated".
  - Otherwise infer it ONLY from the technician's own words ("these look good" → good). rating_basis = "inferred".
- note: a short, cleaned-up version of what the technician said about this component, written for a car owner.
  Remove filler words and instructions to the app (like "mark it needs attention").
  Use ONLY what was said. Do NOT add measurements, causes, diagnoses, or repair recommendations the
  technician did not state. Keep any numbers exactly as spoken.
- mentions: every time the technician talks about this component:
  - quote: the technician's exact words about it, verbatim.
  - visible_start_s, visible_end_s: seconds from the start of the video when the component is on camera
    around this mention. If it is never clearly on camera, use when it is being discussed.
  - best_frame_s: the second with the clearest, steadiest view of the component.

Do not create lines for things that are only visible but never talked about, or for chit-chat ("okay, moving on").
Return JSON that matches the schema.
```

### Response schema

Each line also has a required `car_zone` (added with migration `0006`): one of the zone keys in `lib/carZones.ts`, or
`"none"`. The prompt explains it ("left" = driver's side; "none" when there's no single spot, e.g. "front brakes"
covering both sides). `"none"` and unknown values become null in `validate.ts`, so a bad zone never drops a line.
`lib/ai/responseSchema.ts` is the source of truth; the block below is the original draft.

```ts
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          component_name: { type: Type.STRING },
          rating:         { type: Type.STRING, enum: ['good', 'monitor', 'needs_attention'] },
          rating_basis:   { type: Type.STRING, enum: ['stated', 'inferred'] },
          note:           { type: Type.STRING },
          mentions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                quote:           { type: Type.STRING },
                visible_start_s: { type: Type.NUMBER },
                visible_end_s:   { type: Type.NUMBER },
                best_frame_s:    { type: Type.NUMBER },
              },
              required: ['quote', 'visible_start_s', 'visible_end_s', 'best_frame_s'],
            },
          },
        },
        required: ['component_name', 'rating', 'rating_basis', 'note', 'mentions'],
      },
    },
  },
  required: ['lines'],
};
```

### Transcript (captions)

The same call also returns `transcript`: everything the technician says, verbatim, as short caption
segments `{ text, start_s, end_s }` timed to when the words are spoken (the prompt and
`lib/ai/responseSchema.ts` are the source of truth; the blocks above predate it). `repairTranscript`
clamps, sorts and trims overlaps; a missing transcript is not an error. The worker replaces the
inspection's rows in `transcript_segments` (migration `0003`) inside the same `'ai'` transaction as the
lines. `InspectionDetail.transcript` feeds the editor's always-on captions and Transcript tab. It's
tech-only: it never goes into a report version. Captions and the transcript come only from this
transcription, never from mention quotes or other AI output. Saving also sets `inspections.transcribed_at`
(migration `0004`), so an empty transcript with that set means nothing was said ("Nothing was said in this
recording."), while null means it was processed before transcripts existed (the tab suggests a re-process).

### Validate and repair the output

This is a pure function, with unit tests.

1. Parse the output with `zod`.
2. Convert seconds to ms and clamp every time into `[0, duration]`.
3. If `end <= start`, set `end = start + 1000`.
4. Clamp `best_frame` into the visible span.
5. Drop mentions with an empty quote.
6. Drop lines with no mentions, and log them.
7. If no lines remain, fail with `failure_reason = "The AI didn't find any inspected components in this recording."`

---

## 9. Clip ranges and grounding check

Both are pure functions in `/lib` with unit tests.

### Clip ranges (one clip per mention)

Settings: `PAD_BEFORE = CLIP_PAD_BEFORE_MS` (default 3000), `PAD_AFTER = CLIP_PAD_AFTER_MS` (default 3000), `MAX = MAX_AUTO_CLIP_MS` (default 20000).

```
for each mention m:
  range = [m.visible_start - PAD_BEFORE, m.visible_end + PAD_AFTER]
  clamp range to the recorded piece that contains m.best_frame   (never cross a pause point)
  clamp range to [0, duration]

sort all mentions by visible_start
for each adjacent pair (a, b) that belong to DIFFERENT lines and whose padded ranges overlap:
  cut = midpoint(a.visible_end, b.visible_start)
  a.end   = max(a.visible_end,   min(a.end,   cut))   // never cut into a visible span
  b.start = min(b.visible_start, max(b.start, cut))
  (if the visible spans themselves overlap, leave the overlap)

if length(range) > MAX: take a MAX-long window centred on best_frame, kept inside range
```

### Grounding check

`unsupportedNumbers(note, quotes)` returns every number token in the note that doesn't appear in any of the line's quotes. That includes digits, decimals and forms like `4/32`, along with any unit attached.

The editor shows a warning on that line: *"The note mentions 4 mm, but you didn't say that."* This keeps the "never add anything that wasn't said" rule checkable. The editor also marks lines whose rating was **inferred** rather than **stated**, so the tech looks at them.

---

## 10. Screens

The layout is mobile-first: one column, large tap targets. Ratings always show **text plus color**, never color alone. There are no browser `alert` or `confirm` dialogs; confirmation happens in the page itself.

### `/` Home

- A list of inspections, newest first.
- Each row shows vehicle and customer ("Untitled inspection" until filled in), a status badge, the date, and an "Unsent changes" badge when that applies.
- Every inspection has a **Delete** action with an in-page confirm, disabled while processing. For a sent inspection the confirm warns that the customer's link will stop working.
- A **New inspection** button. On a phone (`pointer: coarse` and a narrow screen) it creates the inspection and goes straight to the recorder. On a laptop it opens `/inspections/[id]`, which shows the pairing QR code.

### `/inspections/[id]/record` Recorder

See section 6.

### `/inspections/[id]` Inspection

This page changes with the inspection's status.

**`recording`, as seen on a laptop.** This is the QR pairing view:

- A QR code for `${PUBLIC_BASE_URL}/inspections/${id}/record`, rendered with the `qrcode` package.
- A "Record on this device" link.
- A live list of uploaded parts, each with a small player, filled in by polling.

The "pairing" is just both devices opening the same inspection. No pairing state is stored.

**`processing`.** Shows the steps with live progress:

- Uploading
- Converting
- AI reviewing
- Cutting clips *n/m*

The tech can close the page and come back later.

During Converting and AI reviewing there's a **Cancel processing** button with an in-page confirm. Cancelling sends the inspection back to a **draft** (status `recording`, parts kept) and returns to the home list; the tech can continue recording or finish it again. It is not `failed`: that is only for real errors (AI or conversion). Changed 2026-11-17.

**`failed`.** Shows the failure reason and a **Retry** button.

**`ready_for_review` / `sent`.** The editor:

- **Customer and vehicle details** at the top: name, year, make, model, VIN. The VIN is uppercased and validated as 17 characters with no I, O or Q. Each field saves when it loses focus.
- **One card per line:**
  - name input
  - rating control: three labelled buttons
  - note text area
  - main photo
  - a collapsible "What you said" section with the quotes (tech only)
  - warnings: unsupported numbers, inferred rating, failed clip
  - a clips row; tapping it opens the clip panel
  - up/down buttons to reorder, and delete with an in-page confirm
- **Add line:** name, rating and note, then choose a clip range. A clip is required before sending.
- **Clip panel:**
  - a player for the stitched video, with pause points marked on the timeline
  - **Set start / Set end** at the playhead, plus ±0.5 s nudge buttons
  - Preview plays just the selected range
  - Save queues a re-cut
  - a strip of thumbnail candidates, plus **Use current frame** (queues `extract_frame`)
  - add, delete and reorder clips
  - manual clips **may** cross pause points; the markers make that visible
- **Bottom bar:** **Send to customer**, which becomes **Send update** after the first send.
  - It's disabled with a list of reasons when Send would fail.
  - After a successful send, it shows the share link with Copy and a QR code.
- **On a laptop:** (`components/editor/studio`) the video top-left with a seek bar and Mark In / Mark Out; flags on
  the seek bar mark where each issue's clips start (numbered, colored by rating; click to select). Under the video,
  one column per issue with its clips listed underneath. On the right two tabs. Details: customer and vehicle, the
  selected issue, and the selected clip (its range, delete). Thumbnail: the selected clip's photo
  picker. Transcript: every quote in time order, click to jump. Ranges are set with Mark In / Mark Out; a bar under the video offers Save / Revert while a
  range is changed. Clips are always in time order: saving a range or adding a clip reorders the line's clips by start
  time, so the first (main) clip is the earliest. Range edits are drafts until Save. Shortcuts: Space, ←/→, I/O, P, Enter, Esc.
  Phones keep the one-column layout with the full-screen clip panel. On the phone's Timeline tab there are no big New clip / New issue buttons: **New clip** is in the video controls next to Draw, **New issue** is a **+** at the end of the issue header (arrows), and the clip cards and the selected-clip row are compact so the clips stay visible above the tab bar.
- **Draw** (laptop and phone): with a saved clip selected and the playhead inside it, **Draw** (shortcut D) pauses the
  video and turns the frame into a drawing surface (mouse, pen or finger). An amber bar offers the colors, Undo,
  Clear, how long it shows (1–10 s, default 3 s), Cancel (Esc) and **Save drawing** (Enter). The seek bar and the
  rest of the editor are inert while drawing. On the phone, drawing goes full screen (the video and the drawing bar fill the screen); Save or Cancel returns to the editor. Saved drawings play over the video in the editor too, and the clip's
  **Drawings** list shows when each starts, jumps to it, and deletes it with a confirm. On the laptop it's the **Drawings (n)** menu in the clip bar under the video (with the clip's range, cut status / Retry cut and Delete clip; Details no longer has Clip or Drawings sections); on the phone it's under the selected clip on the Timeline tab, hidden until the clip has a drawing.
- **Where on the car** (issue section): a small top-down car; click a part to set the line's zone, or **Not on the
  car**. Shows when it differs from the AI's suggestion. Add line shows the zone guessed from the name.
- **Re-process (development only):** shown when `ENABLE_REPROCESS=true` and the inspection is `ready_for_review`, never after sending. An in-page confirm warns: *"This replaces all lines, including your edits."*

### `/r/[token]` Customer page

This page is read-only and shows the **latest version**.

- **Header:** vehicle and customer, the VIN (confirmed 2026-11-17), the date, the version, and "Updated {date}" when the version is above 1.
- **Summary:** e.g. "2 need attention · 1 to monitor · 5 good".
- **Line sections:** **Needs attention → Monitor → Good**, keeping the tech's order within each section.
- **Each line:** name, rating badge, note, main photo (tap to play the main clip inline), "+N more clips", and an **Updated** or **New** badge compared with the previous version.
- **"What changed since version N−1"** (collapsible): lines added, changed and removed.
- **Version history:** links to older versions (`/r/[token]?v=1`).
- **Never shown:** quotes, AI originals, warnings, edit controls.
- **Where on your car** (`CarMap`): the top-down car, each zone with an issue tinted by its worst rating, the playing
  issue's zone outlined, tap (or Enter) to play its worst issue. A legend shows the ratings as text, and issues with no
  zone are listed underneath. The car lies sideways (front to the right, driver's side on top) at the top of the
  issues panel, with the filter chips and issues below it, on laptop and phone (owner, 2026-11-17).
  On the laptop the car and chips stay fixed and only the issue cards scroll. On the phone the car is compact (small
  diagram, one-line heading, tight legend) and there is no list: **one card** at the bottom shows the playing issue
  (name, rating, full note, clip buttons) and switches, with a short fade, whenever playback moves to a new issue
  (a clip ended, the arrows, or a tap on the car). There are no filter chips on the phone. The card fits above the tab bar; a long note scrolls
  inside the card, never under the bar (owner, 2026-11-17).
- **Drawings** from the tech play over the clip, each during its window, aligned to the frame (`AnnotationOverlay`).
  Never over the photo. A clip with drawings hides the native fullscreen button, which would hide the overlay.
- **Players and photos** fit both portrait and landscape media without cropping (`object-fit: contain`, with a max height so the page stays scrollable).

---

## 11. API: Next.js route handlers (drafted)

- Every handler runs on the server with the `postgres` client.
- Request bodies are validated with `zod`.
- Errors are returned as `{ error: string }` with the right status code. Errors raised by `send_report` come back as `409` with the database message, which is written to be shown to the tech.
- **Don't use Server Actions for uploads**, because of their small default body limit. Don't add middleware on the upload path. Stream request bodies through to Storage rather than holding whole files in memory.

| Method & path | Does |
|---|---|
| `POST /api/inspections` | Create an inspection (`status='recording'`) and return `{ id }` |
| `GET /api/inspections` | Home list |
| `GET /api/inspections/[id]` | Everything for the inspection page: inspection, segments, lines, ai_suggestions, mentions, clips, frames, unsent-changes flag, progress counts |
| `PATCH /api/inspections/[id]` | Customer and vehicle fields |
| `DELETE /api/inspections/[id]` | Any status except `processing` (409, to avoid racing the worker). Deletes the row (everything cascades, including sent versions), then all Storage files under `{id}/`. |
| `POST /api/inspections/[id]/reprocess` | Development only: returns `404` unless `ENABLE_REPROCESS=true`. Only from `ready_for_review`. Sets `processing`/`analyzing` and queues `process_inspection`, which replaces all lines. |
| `POST /api/inspections/[id]/segments?n=` | Upload a piece. Only allowed while `recording`. Returns `{ segment_number, status, video_cut_at_ms }` (the check in section 6). |
| `DELETE /api/inspections/[id]/segments/[n]` | Retake. Only while `recording`, and only the highest `n`. |
| `POST /api/inspections/[id]/finish` | Requires ≥1 segment, all `uploaded`. Sets `processing`/`converting` and queues `process_inspection`. `409` `code: video_cut` while a piece has `video_cut_at_ms`, unless the body is `{ allow_video_cut: true }`. |
| `POST /api/inspections/[id]/cancel` | Only while `processing` and the step is `converting` or `analyzing` (409 otherwise; cutting is quick and lines are saved). Sets the inspection back to `recording` (a draft, parts kept) and fails queued jobs. A running job skips the AI step if it hasn't started it, or discards its result. |
| `POST /api/inspections/[id]/retry` | Only from `failed`. Sets `processing` and queues the job again. |
| `POST /api/inspections/[id]/lines` | Add a tech line |
| `POST /api/inspections/[id]/lines/reorder` | Calls `reorder_lines` |
| `PATCH /api/lines/[lineId]` | name, note, rating |
| `DELETE /api/lines/[lineId]` | Delete a line (its clips cascade) |
| `POST /api/lines/[lineId]/clips` | Add a clip `{ start_ms, end_ms }` and queue `cut_clip` |
| `POST /api/lines/[lineId]/clips/reorder` | Calls `reorder_clips` |
| `PATCH /api/clips/[clipId]` | `{ start_ms, end_ms }` sets `pending` and queues `cut_clip`. `{ thumbnail_frame_id }` sets the thumbnail directly. `{ annotations }` replaces the clip's drawings (no re-cut); a new or moved drawing must show inside the clip's range (400). |
| `DELETE /api/clips/[clipId]` | Delete a clip |
| `POST /api/clips/[clipId]/frames` | `{ timestamp_ms }` queues `extract_frame` |
| `POST /api/inspections/[id]/send` | Calls `send_report` and returns `{ shareUrl }` |
| `GET /api/share/[token]?v=` | A version (latest by default), the previous version for diffing, and the version list |
| `GET /api/media/[...path]` | Storage proxy with Range support (section 5) |

**Security note.** There's no auth, so anyone with the tunnel URL and an inspection id can edit that inspection. Inspection ids are random UUIDs and the customer only gets the separate token, but the tunnel should still run **only while developing or demoing**.

---

## 12. Setup (drafted, to become the README)

**Prerequisites**

- Node 20+
- Docker Desktop
- Supabase CLI
- ffmpeg, including ffprobe
- `cloudflared` (or ngrok)
- a Gemini API key

**Steps**

```bash
npm install
supabase start                 # prints API URL, DB URL and the service_role key
supabase db reset              # applies migrations + seed (creates the storage bucket)
cp .env.example .env.local     # fill in the values below
npm run dev:all                # Next.js on :3000 + the worker
cloudflared tunnel --url http://localhost:3000
# copy the https://<random>.trycloudflare.com URL into PUBLIC_BASE_URL
# and into allowedDevOrigins in next.config, then restart `npm run dev:all`
```

Open `PUBLIC_BASE_URL` on both the laptop and the phone. **Don't use `localhost` on the laptop**, or the QR codes and share links will point to `localhost`.

**`.env.example`**

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres   # ports are 55xxx, see supabase/config.toml
SUPABASE_URL=http://127.0.0.1:55321
SUPABASE_SERVICE_ROLE_KEY=
STORAGE_BUCKET=inspection-media
GEMINI_API_KEY=
GEMINI_MODEL=            # a current Gemini Flash model id
PUBLIC_BASE_URL=         # your tunnel's https URL
CLIP_PAD_BEFORE_MS=3000
CLIP_PAD_AFTER_MS=3000
MAX_AUTO_CLIP_MS=20000
MAX_RECORDING_MS=600000
ENABLE_REPROCESS=true    # development only; set to false for the demo
```

Quick tunnel URLs change on every run. Use a named Cloudflare tunnel if you want a stable URL.

---

## 13. Build order (drafted)

Each step should work end to end before moving on.

1. **Scaffold.** Next.js + TS, Supabase local, the migration and seed, the env file, an empty worker loop, the tunnel. *Done when the home page loads on the phone through the tunnel.*
2. **Recorder and upload.** Tips overlay, recorder, pause/resume as segments, retake, uploads, finish. *Done when a recorded inspection's pieces show up in Storage. Test on the real phone early.*
3. **Converting and stitching** in the worker. *Done when `stitched.mp4` plays correctly, including across pause points.*
4. **Gemini.** First write a small script that runs the prompt on a test video and prints the JSON, then tune the prompt. After that, add validation, the grounding check, and saving results. *Done when the brief's tire and wipers examples come out right.*
5. **Clips and frames.** Clip ranges, cutting, candidate frames, sharpness, thumbnails, reaching `ready_for_review`.
6. **Editor**, read-only first, then: line edits, add/delete/reorder lines, the clip panel (ranges, thumbnails, add/remove/reorder clips), customer and vehicle details.
7. **Send and the customer page.** `send_report`, versions, the share link, the summary and grouping, version diffs and history.
8. **Laptop pairing view and home list**, plus processing progress and failure/retry.
9. **Polish, README, and the demo** recorded with the owner's own inspection.

---

## 14. Testing (drafted)

Test logic that can actually break. Don't aim for a coverage number.

- **Unit tests (vitest):**
  - clip-range algorithm: padding, pause points, overlap with neighbours, max length, video edges
  - `unsupportedNumbers`
  - Gemini output validation and repair, using recorded JSON fixtures that include bad timestamps and empty quotes
  - the version diff: added, changed, removed
  - the recording check: `trackEnds` / `videoCutAt` (a picture that stops early, Safari's stretched last frame) and `recorderStalled`
- **Database tests** against the local DB (`npm run test:db`, `tests/db/`; each test rolls back):
  - `send_report` refuses each invalid case and creates correct frozen copies
  - the constraints in section 4 reject bad rows
  - `log_edit` records tech edits, skips worker bookkeeping, and handles deleting a whole inspection
- **Manual end-to-end checklist:**
  - record with two pauses and a retake
  - record once in portrait, once in landscape, and once switching between them partway through
  - on an iPhone: start recording, then open Control Center or turn on the flashlight; the recorder should pause with the camera warning and Resume should work
  - upload a piece whose picture stops early; its part should be marked and Finish should ask before going ahead
  - process
  - edit a rating, a clip range and a thumbnail; draw on a clip (full screen on the phone) and check it plays on the customer page
  - send
  - open the link on another phone
  - edit again and Send update; check the badges and older versions

---

## 15. Out of scope for now

- Login, shops, and multi-tenancy
- Customer approval of work
- A live camera view on the laptop
- A native-camera or file-upload fallback for recording
- Adding pieces after processing has started
- VIN barcode scanning

---

## 16. Open questions

None right now. Every question from planning has an answer in the decisions log (section 2).

If you reach a decision this plan doesn't cover, **ask the owner instead of guessing.**
