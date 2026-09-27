-- Jeff: 之前班表的排序是在 Name display 那邊，但 Name display 現在搬到 Staff
-- Information 了，所以要在 Roster Hub > Setting 底下新增「Roster Staff
-- Order」來編排員工在班表上的順序；還要有一個區塊可以設定「不顯示在班表的員工」
-- （在班表按 X 移除的人會自動被分到這裡），從這裡按「恢復到班表」才會把人加回
-- 排序名單。
--
-- Two new persistent, per-store things for Manage Roster's staff list
-- (user_stores = real staff assigned to a store, roster_pending_staff =
-- not-yet-formal hires — the same two sources Manage Roster's grid already
-- combines into one list of rows):
--
--   roster_order        — an explicit position. There was never an
--                          ORDER BY on this list before, so whatever order
--                          Manage Roster/the Excel template/export showed
--                          was just whatever Postgres happened to return.
--                          Roster Hub > Setting > Roster Staff Order lets a
--                          manager drag these into whatever order they
--                          actually want.
--   hidden_from_roster   — set when Manage Roster's ✕ button is clicked
--                          next to a staff/pending row. Previously that ✕
--                          only cleared the row for the CURRENTLY OPEN
--                          week (plain React state in ManageRosterPage,
--                          reset on every week change/page reload —
--                          nothing persisted anywhere), so the row always
--                          came right back the next time that week (or any
--                          other week) was opened. This makes it actually
--                          stick: a hidden person stops auto-populating on
--                          ANY week's grid until a manager restores them
--                          from the new Setting section — which is also
--                          the only place they get added back into the
--                          ordering list.
--
-- This supersedes roster_hidden_staff (migration 0030), which was built
-- for a per-(store, week) hide but — checking the current frontend — was
-- never actually wired up (ManageRosterPage.jsx's ✕ handling is pure local
-- state; nothing anywhere queries this table). Dropping that dead table
-- rather than leaving it sitting next to the new, actually-used columns
-- below with a confusingly similar name/purpose.
drop table if exists roster_hidden_staff;

alter table user_stores add column roster_order integer not null default 0;
alter table user_stores add column hidden_from_roster boolean not null default false;

alter table roster_pending_staff add column roster_order integer not null default 0;
alter table roster_pending_staff add column hidden_from_roster boolean not null default false;

-- Backfill: give every existing store a sane starting order (alphabetical
-- by the name actually shown on the roster — same fallback rule as
-- rosterDisplayName()/pendingRosterName() in excelRoster.js) instead of
-- leaving everyone at the same default 0, which would make the very first
-- open of the new Setting tab show a random-looking order until someone
-- drags it into shape. Real staff and Pending staff share ONE numbering
-- per store (not two separate 1,2,3... sequences) so a manager can freely
-- interleave a Pending hire in between two real staff instead of Pending
-- people being stuck as their own block.
with combined as (
  select 'staff'::text as kind, us.store_id, us.profile_id as ref_id,
         coalesce(us.roster_display_name, p.first_name, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))) as sort_name
  from user_stores us
  join profiles p on p.id = us.profile_id
  union all
  select 'pending'::text as kind, rps.store_id, rps.id as ref_id,
         coalesce(rps.roster_display_name, rps.display_name) as sort_name
  from roster_pending_staff rps
),
ordered as (
  select kind, store_id, ref_id,
         row_number() over (partition by store_id order by sort_name nulls last, ref_id) as rn
  from combined
)
update user_stores us set roster_order = ordered.rn
from ordered
where ordered.kind = 'staff' and ordered.ref_id = us.profile_id and ordered.store_id = us.store_id;

with combined as (
  select 'staff'::text as kind, us.store_id, us.profile_id as ref_id,
         coalesce(us.roster_display_name, p.first_name, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))) as sort_name
  from user_stores us
  join profiles p on p.id = us.profile_id
  union all
  select 'pending'::text as kind, rps.store_id, rps.id as ref_id,
         coalesce(rps.roster_display_name, rps.display_name) as sort_name
  from roster_pending_staff rps
),
ordered as (
  select kind, store_id, ref_id,
         row_number() over (partition by store_id order by sort_name nulls last, ref_id) as rn
  from combined
)
update roster_pending_staff rps set roster_order = ordered.rn
from ordered
where ordered.kind = 'pending' and ordered.ref_id = rps.id and ordered.store_id = rps.store_id;

-- No new RLS policies needed — "manager update user_stores for own store"
-- (0039_user_stores_manager_read_and_display_name_write.sql) and
-- roster_pending_staff's existing "manager admin write roster_pending_staff"
-- policy already allow a manager/admin to update any column on rows for
-- stores they manage, these two new columns included.
