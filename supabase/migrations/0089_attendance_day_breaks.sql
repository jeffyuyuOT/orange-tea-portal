-- Jeff, 2026-10-02: "add attendance record...如果選擇edit break，則輸入
-- break次數(不一定要整數)...後面時間統計顯示扣多少分鐘(算法30*break次數)。
-- Total的時間也會將休息時間扣掉去計算" -- one break value per
-- (profile, store, day) "cell" (same grouping AttendanceLogTable already
-- uses for punches), in the SAME half-hour-unit convention as the roster's
-- own roster_entries.break_half_hours (migration 0008: "e.g. 1 = 30 min,
-- 2 = 1 hr") — not a coincidence: "Copy roster" (AttendanceCellEditModal.jsx)
-- carries a day's roster shift's break value straight across into this
-- column with no unit conversion needed, and it already supports a
-- fractional value the same way roster_entries does, matching Jeff's
-- explicit "不一定要整數" (doesn't have to be a whole number).
--
-- A single current-value row per cell (upserted), not an event-sourced
-- log like attendance_event_edits — Jeff only asked for the current break
-- count plus "edit at <when> [by <who>]" shown inline next to it (see
-- AttendanceLogTable.jsx), not a separate history of every past break
-- value, so edited_by/edited_by_name/edited_at just describe the most
-- recent write.
create table attendance_day_breaks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  event_date date not null,
  break_half_hours numeric not null default 0 check (break_half_hours >= 0),
  edited_by uuid not null references profiles(id),
  edited_by_name text not null,
  edited_at timestamptz not null default now(),
  unique (profile_id, store_id, event_date)
);

create index idx_attendance_day_breaks_cell on attendance_day_breaks(profile_id, store_id, event_date);

alter table attendance_day_breaks enable row level security;

-- Same visibility as attendance_events/attendance_event_edits (migrations
-- 0054/0062): the person themselves, or a manager/admin who can see that
-- store — read-only transparency, no can_edit_attendance_logs_check() gate
-- on SELECT (the "by <who>" part of the inline display is hidden
-- client-side instead, same as how the session-edit "by" text is already
-- gated on the viewer's own canEdit in AttendanceLogTable.jsx).
create policy "read attendance_day_breaks" on attendance_day_breaks
  for select using (
    profile_id = auth.uid()
    or (is_manager_or_admin() and store_id = any (current_store_ids()))
    or is_admin()
  );

-- Upsert (one row per cell), gated the same way as correcting a punch.
create policy "manager insert attendance_day_breaks" on attendance_day_breaks
  for insert with check (
    can_edit_attendance_logs_check() and store_id = any (current_store_ids())
  );

create policy "manager update attendance_day_breaks" on attendance_day_breaks
  for update using (
    can_edit_attendance_logs_check() and store_id = any (current_store_ids())
  ) with check (
    can_edit_attendance_logs_check() and store_id = any (current_store_ids())
  );
