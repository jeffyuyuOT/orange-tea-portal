-- Formula "Update" category: flags formula items that are new or have been
-- edited since this feature went live, per staff member, so managers/staff
-- notice menu/recipe changes without having to be told separately.
--
-- tracked_since is the floor below which an edit doesn't count: it defaults
-- to now() at ALTER time, so every EXISTING item (whatever its real
-- updated_at) gets the exact moment this migration ran — meaning none of
-- them count as "new or updated" for anyone, brand-new staff included, per
-- Jeff's requirement. A brand-new item created after this migration gets
-- created_at/updated_at/tracked_since all equal to the same instant (same
-- transaction snapshot), so it immediately counts as new. Any edit after
-- that (via ItemEditModal's save(), which always issues an UPDATE and so
-- always bumps updated_at through the existing set_updated_at trigger,
-- whether or not the actual field values changed) keeps updated_at moving
-- forward past tracked_since, which never changes again after being set —
-- so eligibility, once earned, never has to be recomputed.
alter table formula_items add column if not exists tracked_since timestamptz not null default now();

-- Per-person "have I seen the CURRENT version of this item" state.
-- seen_updated_at stores the item's updated_at AT THE TIME they opened it —
-- comparing that snapshot to the item's live updated_at (rather than just
-- recording "when they looked") means a later edit reliably shows the item
-- as unseen again, and there's no clock-skew concern between this table and
-- formula_items since both timestamps come from the same database.
create table formula_item_views (
  profile_id uuid not null references profiles(id) on delete cascade,
  formula_item_id uuid not null references formula_items(id) on delete cascade,
  seen_updated_at timestamptz not null,
  primary key (profile_id, formula_item_id)
);

alter table formula_item_views enable row level security;

create policy "own formula_item_views" on formula_item_views
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
