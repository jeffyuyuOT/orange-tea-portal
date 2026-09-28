-- User Management's "Join store activity" checkbox — Jeff, 2026-09:
-- "user management裡的編輯頁面所屬店面的敘述文字Also on the roster at (in
-- addition to Store above)改成also belong to...然後下面多加一個勾選選項
-- Join store activity。勾選的話此user才會在shop management，roster和
-- bulletin的相關設定出現...可以排班...在bulletin裡的message傳送訊息。沒有
-- 勾的話就只能觀看，但不會被選擇。"
--
-- Jeff then split this further (same day): "post and receive Bulletin
-- messages應該要從區分出來勾選，join shop activity則包含schedulable on
-- Manage Roster(包含可以申請leave，加入排班和listed in Roster Staff Order
-- and staff availability)，shown in staff information，shown in learner
-- tracker，shown in staff times logs" — so Bulletin participation is its
-- OWN, separate checkbox (see migration 0065_bulletin_activity.sql, which
-- also carries the "staff insert own announcements" policy this file
-- originally, briefly, pointed at active_store_ids() itself before that
-- split — moved there instead). THIS migration ended up covering, in its
-- final form: Manage Roster / Roster Staff Order / Learning Tracker /
-- Staff Information / Staff Time Logs (all already handled at the app
-- layer via isActiveStoreMember(), shipped separately from this file) plus
-- leave application and staff availability (handled below/via RLS).
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
--     Learning Tracker, Staff Information, Staff Time Logs) and can't apply
--     for leave there.
--   - checked — behaves exactly like before this migration: a full active
--     participant at every store they belong to.
--
-- Default TRUE here so this migration doesn't silently strip any existing
-- multi-store person (an admin/manager already set up with extra stores)
-- out of rosters/leave they're currently active on — Jeff turns this off
-- per-person from User Management for the "view only" cases he actually
-- wants.
alter table profiles add column join_store_activity boolean not null default true;

-- Mirrors current_store_ids() (0001_init.sql) exactly, except a person's
-- ADDITIONAL user_stores rows only count when join_store_activity is true —
-- their primary_store_id always counts, same as current_store_ids(). Used
-- wherever "which stores can I actively DO something at" needs to differ
-- from "which stores can I view" (current_store_ids() itself is
-- deliberately left untouched — view access via RLS read policies is not
-- supposed to change here, only staff-list membership/leave/etc).
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

-- "可以申請leave" — applying for one's OWN leave at an additional store
-- now needs Join store activity checked there too. Previously the
-- self-insert branch of this policy ("profile_id = auth.uid()") had NO
-- store_id check at all — any signed-in staff/manager could insert a
-- leave_requests row for themselves at literally any store_id, active
-- member or not. Tightened to active_store_ids() here, since "which
-- stores can I apply for leave at" is exactly what this flag answers. The
-- manager/admin branch (approving/managing someone ELSE's leave) is
-- untouched.
drop policy "insert own leave_requests" on leave_requests;
create policy "insert own leave_requests" on leave_requests for insert with check (
  (profile_id = auth.uid() and store_id = any (active_store_ids()))
  or is_manager_or_admin()
);

-- Note: staff availability (availability_days/availability_windows,
-- migration 0063) is deliberately NOT store-scoped at all — it's the
-- person's own time, not tied to any one store's roster — so "listed in
-- ... staff availability" is already satisfied for free: Manage Roster's
-- "View Staff's Availability" modal and RosterEntryGrid's soft
-- shift-conflict warning both only ever see whoever's already in
-- ManageRosterPage's own `staff` list, which is filtered by
-- isActiveStoreMember() (backed by this migration's flag) already. No
-- further RLS change needed for that part.
