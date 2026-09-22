-- 1) Roster Hub > Setting > "Name display": lets each store override the
--    name shown for a person on the roster grid / Excel import-export
--    (defaults to first name only, no family name — the app fills that
--    default in when this is null).
alter table profiles add column if not exists roster_display_name text;
-- One-time backfill so existing staff already show a sensible default
-- instead of every row looking unset the first time this page is opened.
update profiles set roster_display_name = first_name where roster_display_name is null and first_name is not null;

-- 2) "Pending staff": a lightweight, account-free entry for a casual/
--    one-off name that shows up on an imported roster but isn't (yet) an
--    invited User Management account — profiles.id is a hard FK to
--    auth.users, so a name-only person can't live there. Confirmed via the
--    Manage Roster import-reconcile flow, or added by hand from Name
--    display.
create table if not exists roster_pending_staff (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);
alter table roster_pending_staff enable row level security;
create policy "read roster_pending_staff" on roster_pending_staff for select using (store_id = any(current_store_ids()) or is_admin());
create policy "manager admin write roster_pending_staff" on roster_pending_staff for all using (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
) with check (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
);

-- 3) Backfill user_stores from each profile's primary_store_id. This join
--    table has existed since 0001_init.sql specifically for multi-store
--    assignment (e.g. an admin who only works some stores), but nothing
--    has ever written to it — every profile's only store membership has
--    been its single primary_store_id. Backfilling it means "which
--    store(s) is this person on the roster for" can now be read from
--    user_stores alone, and admins can be added to additional stores (or
--    removed from stores they don't work at) via User Management without
--    disturbing their primary_store_id.
insert into user_stores (profile_id, store_id)
select id, primary_store_id from profiles where primary_store_id is not null
on conflict do nothing;

-- 4) Manage Roster's Save/Submit used to insert a brand new roster_periods
--    row on every click, so re-saving the same week repeatedly filled
--    History with near-duplicate drafts of the same week (see the
--    3-in-a-row "2026-09-21 → 2026-09-27" entries reported). Saving should
--    instead update that week's one existing record.
--
-- First, collapse any pre-existing duplicates for the same store+week down
-- to the most recently saved one (its entries are the most complete/
-- correct version) — older duplicates' roster_entries cascade-delete with
-- them.
delete from roster_periods rp
where exists (
  select 1 from roster_periods rp2
  where rp2.store_id = rp.store_id
    and rp2.week_start_date = rp.week_start_date
    and (rp2.created_at > rp.created_at or (rp2.created_at = rp.created_at and rp2.id > rp.id))
);

-- Now that duplicates are gone, make (store_id, week_start_date) unique so
-- the app can upsert on it — this is also what actually prevents the
-- duplicate-row bug from recurring, not just app-code discipline.
alter table roster_periods drop constraint if exists roster_periods_store_id_week_start_date_created_at_key;
alter table roster_periods add constraint roster_periods_store_week_key unique (store_id, week_start_date);

-- created_at now stays fixed at first-save time (upserts never touch it);
-- updated_at tracks the most recent Save/Submit, for History's "Saved …"
-- timestamp.
alter table roster_periods add column if not exists updated_at timestamptz not null default now();
create trigger trg_roster_periods_updated_at before update on roster_periods
  for each row execute function set_updated_at();
