-- User Management's "Join store activity" checkbox — Jeff, 2026-09:
-- "user management裡的編輯頁面所屬店面的敘述文字Also on the roster at (in
-- addition to Store above)改成also belong to...然後下面多加一個勾選選項
-- Join store activity。勾選的話此user才會在shop management，roster和
-- bulletin的相關設定出現...可以排班...在bulletin裡的message傳送訊息。沒有
-- 勾的話就只能觀看，但不會被選擇。"
--
-- One flag per person (confirmed with Jeff: a single global on/off, not one
-- per additional store), governing their ADDITIONAL stores only — the
-- "also belong to" checkboxes below their primary Store. Their primary
-- store is unaffected by this and always counts as fully active; this only
-- narrows what the "also belong to" stores mean:
--   - unchecked (the new default going forward for someone with extras) —
--     they can still switch into and view that store's data (nothing about
--     current_store_ids()/RLS read access changes), but they won't show up
--     in that store's staff lists (Manage Roster, Roster Staff Order,
--     Learning Tracker, Staff Information, Staff Time Logs) and can't post
--     their own Bulletin messages there.
--   - checked — behaves exactly like before this migration: a full active
--     participant at every store they belong to.
--
-- Default TRUE here so this migration doesn't silently strip any existing
-- multi-store person (an admin/manager already set up with extra stores)
-- out of rosters/bulletin they're currently active on — Jeff turns this off
-- per-person from User Management for the "view only" cases he actually
-- wants.
alter table profiles add column join_store_activity boolean not null default true;

-- Mirrors current_store_ids() (0001_init.sql) exactly, except a person's
-- ADDITIONAL user_stores rows only count when join_store_activity is true —
-- their primary_store_id always counts, same as current_store_ids(). Used
-- wherever "which stores can I actively DO something at" needs to differ
-- from "which stores can I view" (current_store_ids() itself is
-- deliberately left untouched — view access via RLS read policies is not
-- supposed to change here, only staff-list membership/posting).
create or replace function active_store_ids()
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(store_id), '{}')
  from (
    select primary_store_id as store_id from profiles where id = auth.uid() and primary_store_id is not null
    union
    select us.store_id
    from user_stores us
    join profiles p on p.id = us.profile_id
    where us.profile_id = auth.uid() and p.join_store_activity
  ) s;
$$;

-- Staff's own Bulletin posting (migration 0056_staff_announcements.sql) is
-- the one RLS-level "傳送訊息" Jeff called out — re-point it at
-- active_store_ids() instead of current_store_ids() so it respects the new
-- flag for a staff member's additional stores. Everything else that used
-- current_store_ids() (reading announcements, manager/admin's own write
-- policy — which is_admin() already bypasses anyway, leave management,
-- roster periods, etc.) is deliberately left alone; Jeff only asked about
-- staff-list membership + this one posting ability.
drop policy "staff insert own announcements" on announcements;
create policy "staff insert own announcements" on announcements
  for insert
  with check (
    current_role_key() = 'staff'
    and store_id = any (active_store_ids())
    and created_by = auth.uid()
  );
