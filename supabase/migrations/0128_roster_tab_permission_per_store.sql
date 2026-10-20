-- Jeff, 2026-10-20 (follow-up to 0127_roster_tab_permission_and_store_default.sql):
-- reworks the Roster tab permission from a single account-wide
-- profiles.can_view_roster_tab boolean to a per-(profile, store) column on
-- user_stores — matching the existing roster_display_name/hidden_from_roster
-- pattern. Raised by Jeff: a staff member on two stores with conflicting
-- "Disable roster" store settings couldn't be represented by one global
-- value. See BulletinPage.jsx / StoreManagementPage.jsx / UserDetailModal.jsx
-- for the matching app-code changes.
--
-- Idempotent/safe to run in full even though steps 1-2 were already applied
-- live during this session (via Supabase MCP execute_sql) — only step 3 (the
-- DROP) never completed there despite no lock contention found, so it's
-- included here for Jeff to finish via the SQL editor / CLI.

-- 1. New per-store column, defaulting true (same default the old
--    profiles column had).
alter table user_stores add column if not exists can_view_roster_tab boolean not null default true;

-- 2. Backfill every existing user_stores row from the old profiles value —
--    a multi-store person starts from the same value on every one of their
--    current memberships, which an admin can then differentiate per store
--    going forward in User Management.
update user_stores us
set can_view_roster_tab = p.can_view_roster_tab
from profiles p
where p.id = us.profile_id;

-- 3. Drop the old single global column now that every user_stores row has
--    its own value.
alter table profiles drop column if exists can_view_roster_tab;
