-- Per-(person, roster week) "have they actually opened this specific
-- roster post" state, for the Bulletin Board's Roster feed items.
--
-- roster_view_state.bulletin_roster_viewed_at (migration 0047) tracked one
-- timestamp per (profile, store) — "did they look at the Roster tab at
-- all" — which cleared every roster item's Update badge at once just from
-- switching to that tab, even for weeks they never actually opened. That's
-- not what was wanted: each "Roster posted: ..." row should keep its own
-- Update badge until THAT SPECIFIC week's roster is opened, and the small
-- dot on the Roster tab itself should stay lit as long as ANY row in the
-- list still has an unopened update — only going out once every row has
-- been opened. This table makes that per-row tracking possible;
-- bulletin_roster_viewed_at is no longer read or written by the app after
-- this and can stay as an unused column (nothing depends on dropping it).
create table if not exists roster_period_views (
  profile_id uuid not null references profiles(id) on delete cascade,
  roster_period_id uuid not null references roster_periods(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (profile_id, roster_period_id)
);

alter table roster_period_views enable row level security;

create policy "own roster_period_views" on roster_period_views
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
