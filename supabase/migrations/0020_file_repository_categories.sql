-- File Repository's category list used to be hardcoded in the frontend —
-- adding or renaming one meant a code change. This moves it into the
-- database so admins can add new categories and freely rename ANY of
-- them — including ones other pages rely on — from the File Repository
-- page itself.
--
-- Renaming is always safe: code never keys off `label`, only off a
-- category's permanent `id`. The three documents My Information downloads
-- (TFN / Super / Parent Consent) are seeded below with fixed, well-known
-- ids for exactly that reason — see src/lib/staffDocumentTypes.js, which
-- hardcodes these same ids. Never change or reuse these three rows' ids.
--
-- Written to be safe to (re-)run even if an earlier draft of this
-- migration already created the table with a since-removed `key` column
-- and its own random-id seed rows.
create table if not exists file_repository_categories (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order int not null default 0
);

alter table file_repository_categories drop column if exists key;

alter table file_repository_categories enable row level security;

drop policy if exists "read file_repository_categories" on file_repository_categories;
create policy "read file_repository_categories" on file_repository_categories for select using (auth.role() = 'authenticated');

drop policy if exists "admin write file_repository_categories" on file_repository_categories;
create policy "admin write file_repository_categories" on file_repository_categories for all using (is_admin()) with check (is_admin());

-- If an earlier run already inserted these six built-in categories under
-- random ids (matched here by their label, unchanged across versions of
-- this migration), move each one onto its fixed id in place rather than
-- inserting a duplicate.
update file_repository_categories set id = '00000000-0000-0000-0000-000000000001' where label = 'TFN Declaration Form (blank template)' and id <> '00000000-0000-0000-0000-000000000001';
update file_repository_categories set id = '00000000-0000-0000-0000-000000000002' where label = 'Super Choice Form (blank template)' and id <> '00000000-0000-0000-0000-000000000002';
update file_repository_categories set id = '00000000-0000-0000-0000-000000000003' where label = 'Parent Consent Form (blank template)' and id <> '00000000-0000-0000-0000-000000000003';
update file_repository_categories set id = '00000000-0000-0000-0000-000000000004' where label = 'Food Safety' and id <> '00000000-0000-0000-0000-000000000004';
update file_repository_categories set id = '00000000-0000-0000-0000-000000000005' where label = 'Training Video' and id <> '00000000-0000-0000-0000-000000000005';
update file_repository_categories set id = '00000000-0000-0000-0000-000000000006' where label = 'Other' and id <> '00000000-0000-0000-0000-000000000006';

-- Seed with the categories that were previously hardcoded in the frontend
-- (no-op for any that already exist, whether from the update above or a
-- previous clean run of this migration).
insert into file_repository_categories (id, label, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'TFN Declaration Form (blank template)', 0),
  ('00000000-0000-0000-0000-000000000002', 'Super Choice Form (blank template)', 1),
  ('00000000-0000-0000-0000-000000000003', 'Parent Consent Form (blank template)', 2),
  ('00000000-0000-0000-0000-000000000004', 'Food Safety', 3),
  ('00000000-0000-0000-0000-000000000005', 'Training Video', 4),
  ('00000000-0000-0000-0000-000000000006', 'Other', 5)
on conflict (id) do nothing;
