-- Sent inspections can now be deleted (owner decision, 2026-11-17).
-- Deleting one removes every sent version with it, so the customer link stops
-- working. report_version_lines / _clips already cascade from report_versions.
alter table report_versions
  drop constraint report_versions_inspection_id_fkey,
  add constraint report_versions_inspection_id_fkey
    foreign key (inspection_id) references inspections(id) on delete cascade;
