-- Reusable maintenance script — NOT a one-time migration, so it lives
-- outside supabase/migrations/ and is meant to be run again any time.
--
-- Jeff, 2026-09: "以後如果要qualified員工都memorize的動作要用哪一個sql" —
-- this is that one. Run it in the Supabase SQL Editor (Ctrl+A, then Run)
-- whenever you want every currently-Qualified staff member's memorized
-- status brought up to date — e.g. after someone new becomes Qualified
-- outside the app's own "Mark as Qualified" flow, or after adding new
-- Formula items / Shop Training content that Qualified staff should be
-- treated as already knowing. Safe to run as often as you like: every
-- write is an upsert that only ever sets memorized = true (never false),
-- and only ever touches profiles where qualified = true — running it
-- twice in a row, or on a day nothing changed, does nothing extra.
--
-- This is the same SQL originally run once as
-- supabase/migrations/0075_backfill_qualified_shop_training_memorized.sql
-- (kept there as a record of when this was first done) — copied here so
-- there's one obvious, permanent place to find it again rather than
-- hunting back through the numbered migration history.
--
-- What it does: a Qualified staff member is treated as "already knows
-- everything" — becoming Qualified normally snapshots every active/
-- visible FORMULA item as memorized (StaffStudyDetail.jsx's
-- markAllCurrentItemsMemorized), but only for whichever ONE store the
-- manager granting it happens to be viewing from, and only for content
-- that existed at that moment. This script instead covers every store
-- each Qualified person actually belongs to, for both Formula
-- (study_progress) and Shop Training (shop_training_progress) — so it
-- also catches anyone Qualified before a newer item existed.
--
-- Visibility: a Shop Training item is store-owned outright (migration
-- 0052) — this only ever marks items belonging to a store the person is
-- actually a member of (user_stores). A Formula item follows the same
-- "no restriction rows = visible everywhere, otherwise only the listed
-- stores" rule as everywhere else in the app (storeVisibility.js).
insert into shop_training_progress (profile_id, shop_training_item_id, memorized, memorized_at)
select distinct p.id, sti.id, true, now()
from profiles p
join user_stores us on us.profile_id = p.id
join shop_training_items sti on sti.store_id = us.store_id
where p.qualified = true
on conflict (profile_id, shop_training_item_id)
do update set memorized = true, memorized_at = excluded.memorized_at;

insert into study_progress (profile_id, formula_item_id, memorized, memorized_at)
select distinct p.id, fi.id, true, now()
from profiles p
join user_stores us on us.profile_id = p.id
join formula_items fi on fi.is_active = true
left join formula_item_stores fis on fis.formula_item_id = fi.id
where p.qualified = true
  and (fis.store_id is null or fis.store_id = us.store_id)
on conflict (profile_id, formula_item_id)
do update set memorized = true, memorized_at = excluded.memorized_at;
