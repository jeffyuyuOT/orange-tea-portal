-- My Availability (Roster Hub) — Jeff, 2026-09: staff declare which hours
-- they're available to work, for a SPECIFIC week (not a recurring weekly
-- template) — the same two-week "This Week"/"Next Week" window My Roster
-- already shows (see rosterWeeks.js's thisWeekStart/nextWeekStart), so a
-- manager building Manage Roster can see it and get warned if a shift
-- conflicts with it.
--
-- Absence of a row for a day means "fully available, all day" (Jeff's
-- explicit default: "沒填寫則預設all available") — a row only ever gets
-- written once someone's actually narrowed a day down from that default,
-- and going back to "All day — Available" deletes the row again rather
-- than storing it redundantly (see availability.js's saveWeekAvailability).
--
-- Deliberately NOT store-scoped (no store_id column) — this is about the
-- PERSON's own time, not any one store's roster, so someone working at more
-- than one store only ever enters it once and it's respected everywhere.
create table availability_days (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  week_start_date date not null,
  entry_date date not null,
  mode text not null default 'all_available' check (mode in ('all_available', 'all_unavailable', 'before', 'after', 'custom')),
  -- Only used by 'before'/'after' — the single boundary time those two
  -- modes need ("available before 14:00" / "available after 18:00").
  boundary_time time,
  updated_at timestamptz not null default now(),
  unique (profile_id, entry_date)
);

create index idx_availability_days_profile_week on availability_days(profile_id, week_start_date);

-- Only populated when mode = 'custom' — one or more specific available
-- windows for that day (e.g. available 9:00–12:00 and 15:00–18:00), each in
-- 15-minute increments per Jeff's spec (enforced client-side via a fixed
-- quarter-hour option list — see availability.js's QUARTER_HOUR_TIMES —
-- same approach Leave Management already uses for half-hour times).
create table availability_windows (
  id uuid primary key default gen_random_uuid(),
  availability_day_id uuid not null references availability_days(id) on delete cascade,
  start_time time not null,
  end_time time not null
);

create index idx_availability_windows_day on availability_windows(availability_day_id);

alter table availability_days enable row level security;
alter table availability_windows enable row level security;

-- Read: the person themselves, or a manager/admin who can see them at one
-- of the manager's own current stores (joined through user_stores, since
-- this table itself carries no store_id — see comment above). Write:
-- self only — this is a self-service declaration of one's own time, same
-- as applying for leave; a manager can VIEW it (Manage Roster's "View
-- Staff's Availability") but never edits it on someone else's behalf.
create policy "read own or managed availability_days" on availability_days
  for select using (
    profile_id = auth.uid()
    or is_admin()
    or (is_manager_or_admin() and exists (
      select 1 from user_stores us where us.profile_id = availability_days.profile_id and us.store_id = any (current_store_ids())
    ))
  );

create policy "write own availability_days" on availability_days
  for insert with check (profile_id = auth.uid());

create policy "update own availability_days" on availability_days
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "delete own availability_days" on availability_days
  for delete using (profile_id = auth.uid());

create policy "read own or managed availability_windows" on availability_windows
  for select using (
    exists (
      select 1 from availability_days d
      where d.id = availability_windows.availability_day_id
      and (
        d.profile_id = auth.uid()
        or is_admin()
        or (is_manager_or_admin() and exists (
          select 1 from user_stores us where us.profile_id = d.profile_id and us.store_id = any (current_store_ids())
        ))
      )
    )
  );

create policy "write own availability_windows" on availability_windows
  for insert with check (
    exists (select 1 from availability_days d where d.id = availability_windows.availability_day_id and d.profile_id = auth.uid())
  );

create policy "update own availability_windows" on availability_windows
  for update using (
    exists (select 1 from availability_days d where d.id = availability_windows.availability_day_id and d.profile_id = auth.uid())
  ) with check (
    exists (select 1 from availability_days d where d.id = availability_windows.availability_day_id and d.profile_id = auth.uid())
  );

create policy "delete own availability_windows" on availability_windows
  for delete using (
    exists (select 1 from availability_days d where d.id = availability_windows.availability_day_id and d.profile_id = auth.uid())
  );
