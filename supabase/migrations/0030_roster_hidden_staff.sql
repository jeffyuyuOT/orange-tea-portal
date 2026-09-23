-- Manage Roster auto-populates a row for every staff member (and Pending
-- staff) assigned to a store, even ones who simply aren't working a given
-- week. This lets a manager remove that empty row from just THIS week's
-- grid ("X" next to the name) without touching the person's profile, store
-- assignment, or Pending staff entry — it's per (store, week), not a
-- delete, so the row comes back the moment they're actually scheduled
-- again (or the manager restores them from the "N staff not on this
-- week's roster" list in the UI).
create table roster_hidden_staff (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references stores(id) on delete cascade,
  week_start_date   date not null,
  -- Exactly one of these is set — a real account or a Pending staff entry,
  -- same split used throughout Roster Hub (see migration 0027/0028).
  profile_id        uuid references profiles(id) on delete cascade,
  pending_staff_id  uuid references roster_pending_staff(id) on delete cascade,
  created_at        timestamptz not null default now(),
  check ((profile_id is null) <> (pending_staff_id is null)),
  unique (store_id, week_start_date, profile_id),
  unique (store_id, week_start_date, pending_staff_id)
);

alter table roster_hidden_staff enable row level security;

create policy "read roster_hidden_staff" on roster_hidden_staff for select using (
  store_id = any(current_store_ids()) or is_admin()
);
create policy "manager admin write roster_hidden_staff" on roster_hidden_staff for all using (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
) with check (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
);
