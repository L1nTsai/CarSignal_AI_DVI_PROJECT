-- Clip annotations (owner decision, 2026-11-17): the tech draws on a clip and
-- the customer sees it over the playing video. Strokes are stored as data and
-- drawn as an overlay; nothing is burned into the mp4, so editing never re-cuts.
--
-- Shape (validated by lib/annotations.ts#annotationsSchema):
--   [{ id, start_ms, end_ms, strokes: [{ color, points: [[x, y], ...] }] }]
-- Times are on the STITCHED timeline (like clips.start_ms), so a range change
-- doesn't move a drawing; ones outside the range are just hidden. x/y are 0..1
-- over the full video frame.

alter table clips
  add column annotations jsonb not null default '[]'
    constraint clips_annotations_is_array check (jsonb_typeof(annotations) = 'array')
    constraint clips_annotations_size check (pg_column_size(annotations) <= 262144);

-- Frozen copy. The clip's range is copied too, so the share query can convert
-- the stitched-timeline times to clip time (lib/annotations.ts#toClipTime).
-- Versions sent before this migration have no range and no annotations.
alter table report_version_clips
  add column clip_start_ms integer,
  add column clip_end_ms   integer,
  add column annotations   jsonb not null default '[]'
    constraint report_version_clips_annotations_is_array check (jsonb_typeof(annotations) = 'array'),
  add constraint report_version_clips_range_both check ((clip_start_ms is null) = (clip_end_ms is null)),
  add constraint report_version_clips_annotations_need_range
    check (annotations = '[]'::jsonb or clip_start_ms is not null);

-- log_edit: annotations are a user-meaningful clip field, so drawing counts as
-- a tech edit (and as an unsent change). Otherwise unchanged from 0001.
create or replace function log_edit() returns trigger language plpgsql as $$
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
    v_keys := array['start_ms','end_ms','position','thumbnail_frame_id','annotations'];
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

-- send_report: the frozen clip copy also takes the range and annotations. Otherwise unchanged from 0001.
create or replace function send_report(p_inspection_id uuid) returns text language plpgsql as $$
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
  insert into report_version_clips (report_version_line_id, position, clip_path, thumbnail_path,
                                    clip_start_ms, clip_end_ms, annotations)
  select l.id, c.position, c.path, f.storage_path, c.start_ms, c.end_ms, c.annotations
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
