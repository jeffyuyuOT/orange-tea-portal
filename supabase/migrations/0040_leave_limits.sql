-- Applied directly via Supabase MCP during this session. Saved here after
-- the fact for the repo's migration history. Independent of the
-- roster_display_name mistake in 0038/0041 — this stands on its own.
--
-- Backs Roster Hub > Setting > Leave limits: a weekday/weekend default max
-- concurrent leave-takers per store, plus custom date-range overrides.
-- Enforced client-side in ApplyLeaveTab.jsx (see src/lib/leaveLimits.js).

create table leave_limit_defaults (
  store_id uuid primary key references stores(id) on delete cascade,
  weekday_max integer,
  weekend_max integer,
  updated_at timestamptz not null default now()
);

create table leave_limit_periods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  label text,
  start_date date not null,
  end_date date not null,
  max_count integer not null,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  created_by_name text,
  constraint leave_limit_periods_date_order check (end_date >= start_date)
);

alter table leave_limit_defaults enable row level security;
alter table leave_limit_periods enable row level security;

-- Read mirrors roster_staffing_rules: anyone with this store in their
-- accessible stores (or an admin) can see the limits, so Apply Leave can
-- enforce them.
create policy "read leave_limit_defaults" on leave_limit_defaults
  for select
  using (store_id = any (current_store_ids()) or is_admin());

create policy "manager admin write leave_limit_defaults" on leave_limit_defaults
  for all
  using (is_manager_or_admin() and store_id = any (current_store_ids()) or is_admin())
  with check (is_manager_or_admin() and store_id = any (current_store_ids()) or is_admin());

create policy "read leave_limit_periods" on leave_limit_periods
  for select
  using (store_id = any (current_store_ids()) or is_admin());

create policy "manager admin write leave_limit_periods" on leave_limit_periods
  for all
  using (is_manager_or_admin() and store_id = any (current_store_ids()) or is_admin())
  with check (is_manager_or_admin() and store_id = any (current_store_ids()) or is_admin());
