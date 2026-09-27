-- Admin-editable order for the Sidebar's sections and pages within each
-- section — one shared order for the whole app (not per-role/per-user),
-- per Jeff. Previously this order was purely whatever SECTIONS in
-- permissions.js was written in, with no way to change it without editing
-- code.
--
-- Singleton row: `id boolean primary key default true check (id = true)` is
-- a standard trick for "this table may only ever hold exactly one row" —
-- inserting a second row would need id = true again, which the primary key
-- already forbids, and id can't be anything but true because of the check.
-- There's no equivalent singleton table elsewhere in this schema (the
-- existing `system_settings` is a key/value table, admin-only for BOTH read
-- and write — not a fit here, since every signed-in person needs to READ
-- this order to render their own sidebar, only admin needs to WRITE it).
create table app_sidebar_order (
  id boolean primary key default true check (id = true),
  -- Section keys (e.g. 'operations_training') in display order.
  section_order text[] not null,
  -- { sectionKey: [pageKey, pageKey, ...] } — page keys in display order
  -- within that section.
  page_order jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

-- Seed the one row with the order the app already used (SECTIONS' literal
-- order in permissions.js as of this migration) — so nothing visually
-- changes for anyone until an admin actually reorders something.
insert into app_sidebar_order (id, section_order, page_order) values (
  true,
  array['operations_training', 'dashboard', 'shop_management', 'roster_hub', 'admin_center'],
  jsonb_build_object(
    'operations_training', array['formula', 'shop_training'],
    'dashboard', array['bulletin', 'study_log', 'time_attendance', 'my_information'],
    'shop_management', array['learning_tracker', 'staff_information', 'training_code', 'shop_training_database', 'staff_time_logs', 'qr_code'],
    'roster_hub', array['my_roster', 'manage_roster', 'history', 'leave_management', 'settings'],
    'admin_center', array['formula_database', 'quiz_bank', 'file_repository', 'user_management', 'store_management', 'system_setting']
  )
);

alter table app_sidebar_order enable row level security;

-- Every signed-in person reads this to render their own Sidebar in the
-- shared order — same "any authenticated user" pattern already used for
-- other centrally-managed reference data (e.g. formula_categories).
create policy "read app_sidebar_order" on app_sidebar_order for select using (auth.role() = 'authenticated');

-- Only admin can reorder it (there's only ever the one row, so update is
-- the only write this needs — no insert/delete policy on purpose).
create policy "admin update app_sidebar_order" on app_sidebar_order for update using (is_admin()) with check (is_admin());
