-- Car zones (owner decision, 2026-11-17): where on the car each line is, shown
-- to the customer on a top-down diagram. The AI picks it, the tech can change
-- it, and each sent version freezes it. null = not on the car.
-- The keys are lib/carZones.ts#CAR_ZONE_KEYS; keep both lists in step.
-- "left" is the driver's side.

alter table line_items
  add column car_zone text constraint line_items_car_zone_check check (car_zone in ('front_bumper','headlight_l','headlight_r','hood_engine','wheel_lf','wheel_rf','mirror_l','mirror_r','windshield','door_lf','door_rf','cabin','door_lr','door_rr','wheel_lr','wheel_rr','rear_window','trunk','taillight_l','taillight_r','rear_bumper','underbody'));
alter table ai_suggestions
  add column car_zone text constraint ai_suggestions_car_zone_check check (car_zone in ('front_bumper','headlight_l','headlight_r','hood_engine','wheel_lf','wheel_rf','mirror_l','mirror_r','windshield','door_lf','door_rf','cabin','door_lr','door_rr','wheel_lr','wheel_rr','rear_window','trunk','taillight_l','taillight_r','rear_bumper','underbody'));
alter table report_version_lines
  add column car_zone text constraint report_version_lines_car_zone_check check (car_zone in ('front_bumper','headlight_l','headlight_r','hood_engine','wheel_lf','wheel_rf','mirror_l','mirror_r','windshield','door_lf','door_rf','cabin','door_lr','door_rr','wheel_lr','wheel_rr','rear_window','trunk','taillight_l','taillight_r','rear_bumper','underbody'));

-- log_edit: a zone change is a tech edit (and an unsent change). Otherwise unchanged from 0005.
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
    v_keys := array['component_name','note','rating','position','car_zone'];
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

-- send_report: the frozen line copy also takes car_zone. Otherwise unchanged from 0005.
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
    insert into report_version_lines (report_version_id, source_line_id, position, component_name, note, rating, car_zone)
    select v_version_id, li.id, li.position, li.component_name, li.note, li.rating, li.car_zone
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
