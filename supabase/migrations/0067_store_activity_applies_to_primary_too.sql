-- Amends migrations 0064 (Join store activity) and 0065 (Bulletin
-- checkbox), both already executed — this is a NEW migration rather than
-- an edit to either of those, since they've already run in production.
--
-- Original design: a person's PRIMARY store always counted as a full
-- active participant regardless of join_store_activity/
-- join_bulletin_activity — the two checkboxes only ever gated their
-- ADDITIONAL ("also belong to") stores. Jeff, 2026-09, gave a concrete
-- counter-example that breaks that assumption: "也不行，因為有些腳色他只
-- 是要看到某家店的資訊，但不加入排班等活動，譬如說Janet，她只要看到
-- underwood的店，但不加入排班，所以她主要的所屬店還是要選underwood，但
-- join store activity就不會勾選，所以她也不會在排班相關選項出現" — Janet
-- needs Underwood to be her actual PRIMARY store (not just an "also belong
-- to" one), while still being excluded from scheduling/leave/staff-list
-- activity there. The old "primary always counts" rule made that
-- impossible — unchecking Join store activity was a no-op for her, since
-- it only ever touched additional stores.
--
-- Fix: both active_store_ids() and bulletin_store_ids() now apply their
-- flag uniformly to EVERY store a person belongs to, primary included —
-- the primary-store union branch now requires the flag too, instead of
-- being unconditional. Both flags still default true, so this changes
-- nothing for anyone who's never unchecked either box.
create or replace function active_store_ids()
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(store_id), '{}')
  from (
    select primary_store_id as store_id
    from profiles
    where id = auth.uid() and primary_store_id is not null and join_store_activity
    union
    select us.store_id
    from user_stores us
    join profiles p on p.id = us.profile_id
    where us.profile_id = auth.uid() and p.join_store_activity
  ) s;
$$;

create or replace function bulletin_store_ids()
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(store_id), '{}')
  from (
    select primary_store_id as store_id
    from profiles
    where id = auth.uid() and primary_store_id is not null and join_bulletin_activity
    union
    select us.store_id
    from user_stores us
    join profiles p on p.id = us.profile_id
    where us.profile_id = auth.uid() and p.join_bulletin_activity
  ) s;
$$;

-- Note: current_store_ids() (0001_init.sql) is deliberately untouched —
-- that's plain VIEW access (switching into and seeing a store's data),
-- which was never supposed to change here; Janet can still switch to and
-- view Underwood with Join store activity unchecked, she just won't be
-- schedulable/leave-eligible/listed there.
