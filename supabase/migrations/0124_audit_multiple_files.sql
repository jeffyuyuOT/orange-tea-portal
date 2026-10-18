-- Jeff, 2026-10-18: an audit item can link several File Repository files, not
-- just one. `files` is a jsonb array of { path, name } (path = file_repository.
-- file_path in the documents bucket, name = its display name at link time).
-- Existing single-file links are carried over. Run after 0122 and 0123.

alter table audit_items        add column if not exists files jsonb not null default '[]'::jsonb;
alter table audit_report_items add column if not exists files jsonb not null default '[]'::jsonb;

update audit_items
set files = jsonb_build_array(jsonb_build_object('path', file_path, 'name', coalesce(file_name, file_path)))
where file_path is not null and files = '[]'::jsonb;

update audit_report_items
set files = jsonb_build_array(jsonb_build_object('path', file_path, 'name', coalesce(file_name, file_path)))
where file_path is not null and files = '[]'::jsonb;

alter table audit_items        drop column if exists file_path, drop column if exists file_name;
alter table audit_report_items drop column if exists file_path, drop column if exists file_name;
