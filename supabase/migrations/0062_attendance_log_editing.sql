-- Manager/admin editing of attendance punches (Jeff, 2026-09): Attendance
-- Logs needs to show which store each punch belongs to (a person can work
-- at more than one store), and admin — or a shop_manager explicitly
-- granted this — needs to be able to correct/add punches for someone who
-- forgot to clock in/out, always with a required reason, and with a
-- visible edit history (who, when, what changed, why).

-- Per-user capability flag, same pattern as profiles.cash_in_hand — this is
-- a capability WITHIN the existing Staff Time Logs page, not a whole page
-- of its own, so it doesn't belong in permissions.js's SECTIONS/page-key
-- system (that also drives Sidebar nav / System Setting's sidebar order /
-- the menu export, none of which should grow a phantom nav item for this).
-- Defaults to false for everyone, including shop_manager, per Jeff's
-- explicit "shop manager預設不勾選這個選項" — admin/developer don't need
-- this flag at all (is_admin() already grants edit rights unconditionally
-- below), it only ever matters for a shop_manager account.
alter table profiles add column can_edit_attendance_logs boolean not null default false;

create or replace function can_edit_attendance_logs_check()
returns boolean language sql stable security definer as $$
  select is_admin() or (
    is_manager_or_admin() and exists (
      select 1 from profiles where id = auth.uid() and can_edit_attendance_logs
    )
  );
$$;

-- attendance_events (migration 0054) only had insert (self) + select
-- policies — a punch could never be corrected or backfilled by anyone.
-- Update/delete are for correcting an existing punch's time (or removing a
-- mis-scanned one); this second insert policy is for adding a punch that
-- was simply never made (person forgot to clock in/out) — separate from
-- the original "insert own attendance_events" policy, which only ever
-- covers a person recording their OWN real-time scan.
create policy "manager edit attendance_events" on attendance_events
  for update using (
    can_edit_attendance_logs_check() and store_id = any (current_store_ids())
  ) with check (
    can_edit_attendance_logs_check() and store_id = any (current_store_ids())
  );

create policy "manager delete attendance_events" on attendance_events
  for delete using (
    can_edit_attendance_logs_check() and store_id = any (current_store_ids())
  );

create policy "manager insert attendance_events" on attendance_events
  for insert with check (
    can_edit_attendance_logs_check() and store_id = any (current_store_ids())
  );

-- One row per correction (add/edit/delete of a single punch) — the audit
-- trail Jeff asked for ("點擊顯示更改紀錄會跳出視窗顯示更改內容跟誰和幾時
-- 更改的和附註內容"). Grouped by (profile_id, store_id, event_date) to
-- match how the UI groups punches into one "cell" per person/store/day.
-- `event_id` is kept nullable + ON DELETE SET NULL rather than cascading,
-- so deleting the punch itself (action = 'delete') never erases its own
-- history row.
create table attendance_event_edits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  event_date date not null,
  action text not null check (action in ('add', 'edit', 'delete')),
  event_id uuid references attendance_events(id) on delete set null,
  before_event_type text check (before_event_type in ('clock_in', 'clock_out')),
  before_occurred_at timestamptz,
  after_event_type text check (after_event_type in ('clock_in', 'clock_out')),
  after_occurred_at timestamptz,
  note text not null check (btrim(note) <> ''),
  edited_by uuid not null references profiles(id),
  edited_by_name text not null,
  edited_at timestamptz not null default now()
);

create index idx_attendance_event_edits_cell on attendance_event_edits(profile_id, store_id, event_date);

alter table attendance_event_edits enable row level security;

-- Same visibility as the punches themselves: the person it's about, or a
-- manager/admin who can see that store — read-only transparency, no
-- can_edit_attendance_logs_check() gate on SELECT, so a staff member can
-- always see their own edit history even if they can't make one.
create policy "read attendance_event_edits" on attendance_event_edits
  for select using (
    profile_id = auth.uid()
    or (is_manager_or_admin() and store_id = any (current_store_ids()))
    or is_admin()
  );

create policy "insert attendance_event_edits" on attendance_event_edits
  for insert with check (
    can_edit_attendance_logs_check() and store_id = any (current_store_ids())
  );
