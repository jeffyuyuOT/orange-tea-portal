-- New role: developer — a hidden role for the standalone payroll app
-- (薪水計算系統), embedded in the portal at /developer-tools/payroll for
-- accounts with this role only. It's deliberately NOT visible to admin in
-- User Management (see permissions.js's visibleRoleEntries/roleLabelFor
-- and the UI files that use them) — only a developer account itself can
-- see/set it, and even the admin role's own default page access
-- (ROLE_DEFAULTS.admin) excludes developer_tools.payroll, so an admin
-- can't reach the payroll app either, by role default or by an override
-- granted through a UI that itself hides the checkbox for this section
-- from non-developer viewers.
--
-- Client-side hiding above is cosmetic only. The actual security boundary
-- is here: every payroll_* table below is RLS-restricted to is_developer()
-- so a non-developer account gets nothing back even if it somehow reaches
-- these tables directly (e.g. by loading /payroll/index.html by URL,
-- bypassing the portal's own page-permission gate entirely).
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role = any (array['admin', 'shop_manager', 'staff', 'training', 'qr_code_maker', 'developer']));

alter table pending_staff drop constraint pending_staff_role_check;
alter table pending_staff add constraint pending_staff_role_check
  check (role = any (array['admin', 'shop_manager', 'staff', 'training', 'qr_code_maker', 'developer']));

create or replace function is_developer()
returns boolean language sql stable security definer as $$
  select current_role_key() = 'developer';
$$;

-- One table per object store the payroll app used to keep in its own
-- browser-side IndexedDB (see that app's PART 1) — same shape for all
-- five: the whole record kept as-is in `data`, keyed by whichever field
-- that record already used as its own id/key locally. This 1:1 mapping
-- means only the payroll app's own storage-primitive functions
-- (idbAll/idbGet/idbPut/idbDelete/idbClearAll) had to change to call
-- Supabase instead of indexedDB — the ~1900 lines of calculation engine,
-- Excel import/export and UI above them are untouched.
--
-- The IndexedDB "meta" store (a counters record, plus a File System
-- Access API directory handle for local backups) is intentionally NOT
-- migrated here — a directory handle is a live browser object, not JSON,
-- so it can't be stored in a database row at all, and it only ever made
-- sense on the one browser it was granted permission in. It stays local.
create table payroll_stores (
  row_key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table payroll_employees (
  row_key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table payroll_calc_sheets (
  row_key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table payroll_settings (
  row_key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table payroll_support_ledger (
  row_key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table payroll_stores enable row level security;
alter table payroll_employees enable row level security;
alter table payroll_calc_sheets enable row level security;
alter table payroll_settings enable row level security;
alter table payroll_support_ledger enable row level security;

create policy "developer manage payroll_stores" on payroll_stores for all using (is_developer()) with check (is_developer());
create policy "developer manage payroll_employees" on payroll_employees for all using (is_developer()) with check (is_developer());
create policy "developer manage payroll_calc_sheets" on payroll_calc_sheets for all using (is_developer()) with check (is_developer());
create policy "developer manage payroll_settings" on payroll_settings for all using (is_developer()) with check (is_developer());
create policy "developer manage payroll_support_ledger" on payroll_support_ledger for all using (is_developer()) with check (is_developer());
