-- "Something in the roster changed" notification badges. Jeff's ask: when a
-- staff member's own shift is added/changed on a published roster, an
-- "Update" badge should appear next to "My Roster" in the sidebar for THAT
-- person until they open the page; separately, everyone at that store
-- should see an "Update" badge on the Bulletin Board's Roster tab until
-- *they* (individually) have looked at it.
--
-- Two small tables: roster_change_events records that something changed
-- (who it was for, when) — written by ManageRosterPage.jsx whenever a
-- Submit & Publish actually changes a profile's date/start/end/break versus
-- what was there before (a no-op re-submit writes nothing). roster_view_state
-- records when each person last looked at each badge, per store (someone
-- can work at more than one store — see user_stores) — a person "looking"
-- just means opening My Roster / clicking the Bulletin Roster tab, no extra
-- confirmation step.

create table if not exists roster_change_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  -- Who the change is for. A roster row with no linked profile (an
  -- unmatched raw name — see excelRoster.js reconciliation) has no account
  -- to notify, so this is only ever populated for real, linked staff.
  profile_id uuid references profiles(id) on delete cascade,
  roster_period_id uuid references roster_periods(id) on delete cascade,
  changed_at timestamptz not null default now()
);
create index if not exists roster_change_events_store_idx on roster_change_events(store_id, changed_at);
create index if not exists roster_change_events_profile_idx on roster_change_events(profile_id, changed_at);

alter table roster_change_events enable row level security;

-- Anyone who can already see this store's roster (see "read same-store
-- roster_periods") can see that something on it changed and when — this
-- reveals nothing beyond what the roster itself already shows them.
create policy "read same-store roster_change_events" on roster_change_events
  for select using (store_id = any (current_store_ids()) or is_admin());

-- Only whoever can write roster_periods for that store may log a change —
-- mirrors "manager admin write roster_periods".
create policy "manager admin write roster_change_events" on roster_change_events
  for insert with check ((is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin());

create table if not exists roster_view_state (
  profile_id uuid not null references profiles(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  my_roster_viewed_at timestamptz,
  bulletin_roster_viewed_at timestamptz,
  primary key (profile_id, store_id)
);

alter table roster_view_state enable row level security;

-- Purely a personal "last looked at" cursor — only the person themselves
-- ever needs to read or write their own row.
create policy "own roster_view_state" on roster_view_state
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
