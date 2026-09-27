-- Time & Attendance / QR clock-in system.
--
-- New role: qr_code_maker — a device account (not a person) meant for a
-- phone mounted in the store, whose only permitted page is the rotating QR
-- display (see permissions.js / QrCodeDisplayPage.jsx). Both profiles and
-- pending_staff carry a role CHECK constraint that needs the new value.
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role = any (array['admin', 'shop_manager', 'staff', 'training', 'qr_code_maker']));

alter table pending_staff drop constraint pending_staff_role_check;
alter table pending_staff add constraint pending_staff_role_check
  check (role = any (array['admin', 'shop_manager', 'staff', 'training', 'qr_code_maker']));

-- One row per clock-in/clock-out punch. Sessions (a paired clock_in +
-- clock_out) and daily totals are computed client-side from these raw
-- events — see src/lib/attendance.js's pairEventsIntoSessions/dailyTotals —
-- rather than stored, so there's nothing to keep in sync if the pairing
-- logic ever needs to change.
create table attendance_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_attendance_events_profile on attendance_events(profile_id, occurred_at);
create index idx_attendance_events_store on attendance_events(store_id, occurred_at);

alter table attendance_events enable row level security;

-- Split insert/select policies (rather than the usual single "own row" for
-- all policy) because reads aren't purely "own data" here — managers/admin
-- need to see everyone's punches at their store for Staff Time Logs, while
-- a punch can only ever be inserted by the person it's for.
create policy "insert own attendance_events" on attendance_events
  for insert with check (profile_id = auth.uid());

create policy "read attendance_events" on attendance_events
  for select using (
    profile_id = auth.uid()
    or (is_manager_or_admin() and store_id = any (current_store_ids()))
    or is_admin()
  );
