-- Jeff, 2026-10-11: "staff time log裡時間跟班表差距15分鐘以上的警示視窗，每
-- 一筆的後面都新增Hide prompts，勾取的話此筆紀錄就不會造成小紅點提示" — a
-- per-DAY dismissal, deliberately different in shape from
-- time_discrepancy_views (migration 0076): that one is a per-VIEWER "I've
-- seen this person's current discrepancy" cursor that re-flags itself on any
-- new punch edit/roster republish (Jeff's own wording there was explicit:
-- "跟隨user, userA看過後並不會影響user B的提示"). This request has no such
-- "for me"/per-user qualifier — "此筆紀錄就不會造成小紅點提示" reads as a
-- per-RECORD "this specific day is a known/explained exception" flag, so
-- once any manager/admin hides day X for profile Y, it stays hidden for
-- every viewer's red dot (and in every viewer's list) until someone
-- unchecks it. Existence of a row = hidden; there's no other state to store,
-- so no boolean column is needed.
create table time_discrepancy_hides (
  profile_id uuid not null references profiles(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  work_date date not null,
  hidden_by uuid references profiles(id),
  hidden_at timestamptz not null default now(),
  primary key (profile_id, store_id, work_date)
);

create index idx_time_discrepancy_hides_profile on time_discrepancy_hides(profile_id, store_id);

alter table time_discrepancy_hides enable row level security;

-- Same visibility shape as attendance_day_breaks (migration 0089): the
-- subject themselves can read which of their own days are hidden (harmless
-- transparency, same as every other attendance-adjacent table), a manager/
-- admin can read/write for a store they can see, and admin/developer bypass
-- the store check entirely (same as every other Staff Time Logs write path
-- — see StaffTimeLogsPage.jsx's own "is_admin() bypasses the store check"
-- comment for punch correction).
create policy "read time_discrepancy_hides" on time_discrepancy_hides
  for select using (
    profile_id = auth.uid()
    or (is_manager_or_admin() and store_id = any (current_store_ids()))
    or is_admin()
  );

create policy "manager insert time_discrepancy_hides" on time_discrepancy_hides
  for insert with check (
    (is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin()
  );

create policy "manager delete time_discrepancy_hides" on time_discrepancy_hides
  for delete using (
    (is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin()
  );
