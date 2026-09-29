-- Jeff, 2026-09: "把目前qualified的員工都memorized，因為shop training是新
-- 加的，所以也要memorized" — a one-time data backfill, not a schema change
-- (safe/idempotent to re-run — every write below is an upsert that only
-- ever sets memorized = true, never false, and never touches anyone who
-- isn't currently Qualified).
--
-- Qualified staff are treated as "already knows everything" — becoming
-- Qualified (Formal Quiz Pass, or the direct "Mark as Qualified" button)
-- snapshots every active/visible FORMULA item as memorized right now (see
-- StaffStudyDetail.jsx's markAllCurrentItemsMemorized, migration 0049).
-- Shop Training progress (shop_training_progress, migration
-- 0073_admin_quiz_bank_and_shop_training_progress.sql) didn't exist as a
-- concept until this session, so no currently-Qualified staff member has
-- ever had it backfilled — this does that now, and re-runs the same
-- snapshot for Formula too (covering anyone who became Qualified before a
-- newer formula item existed, or before they were added to a second
-- store — the app's own button only snapshots whichever ONE store the
-- manager granting it happens to be viewing from at that moment; this
-- covers every store each Qualified person actually belongs to).
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
