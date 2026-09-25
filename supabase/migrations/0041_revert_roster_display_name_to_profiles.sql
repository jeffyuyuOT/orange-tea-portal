-- ⚠️ NOT YET APPLIED — this session was blocked from running DDL against
-- the shared production database directly (a safety guard on modifying
-- shared resources) and could not complete this migration on its own.
-- Jeff: please run this yourself in the Supabase SQL editor (or via
-- `supabase db push` / the CLI) as soon as you can — until it runs, the
-- production database is in the broken state left by 0038: every save
-- from Shop Management > Staff Information > (a staff member) will fail,
-- because StaffDetailModal.jsx still writes profiles.roster_display_name
-- and that column doesn't exist right now.
--
-- Reverts 0038_roster_display_name_per_store.sql. Restores
-- profiles.roster_display_name (the column StaffDetailModal.jsx and every
-- other real reader still expects), backfilling losslessly from
-- user_stores.roster_display_name (itself copied 1:1 from profiles by
-- 0038, verified with no per-profile conflicts before writing this), then
-- drops the now-unused user_stores column.

alter table profiles add column roster_display_name text;

update profiles p
set roster_display_name = us.roster_display_name
from (
  select distinct profile_id, roster_display_name
  from user_stores
  where roster_display_name is not null
) us
where us.profile_id = p.id;

alter table user_stores drop column roster_display_name;
