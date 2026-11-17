insert into storage.buckets (id, name, public) values ('inspection-media', 'inspection-media', false)
on conflict (id) do nothing;
