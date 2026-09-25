-- ⚠️ NOT YET APPLIED — same as 0041, this session is currently blocked from
-- running schema changes (DDL) directly against the shared production
-- database. Jeff: please run this in the Supabase SQL editor.
--
-- Real per-store display name feature: Staff Information already has a
-- store switcher (top right, same one used everywhere else) — a
-- multi-store employee should be able to have a different display name at
-- each store, edited from Staff Information while viewing that store.
-- This re-adds user_stores.roster_display_name (previously added by 0038,
-- then reverted by 0041) as the real per-store storage this time, and
-- backfills it from the current single-value profiles.roster_display_name
-- as a starting point (same value at every store to start; edit any store
-- from Staff Information to make it different there).
--
-- profiles.roster_display_name is left in place (not dropped) — the app
-- code no longer writes to it after this session's changes, but leaving
-- the column avoids a third churn cycle on it; it can be dropped later
-- once everyone's happy the per-store version is working.

alter table user_stores add column roster_display_name text;

update user_stores us
set roster_display_name = p.roster_display_name
from profiles p
where p.id = us.profile_id and p.roster_display_name is not null and p.roster_display_name <> '';
