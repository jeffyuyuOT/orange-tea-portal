-- Jeff, 2026-10-20 (points 3 & 4):
--   3. A new per-profile permission, "Roster tab" under My Dashboard in User
--      Management -- when off, that person's Bulletin Board hides the Roster
--      filter/feed entirely. Same plain-column pattern as
--      profiles.can_view_staff_confidential (not the page_key/
--      permission_overrides system, since it's a capability within a page,
--      not a page of its own).
--   4. A new per-store default, "Disable roster" in Store Management (next
--      to the existing Audit checkbox) -- toggling it bulk-sets
--      can_view_roster_tab for every profile currently in user_stores at
--      that store (app-side, StoreManagementPage.jsx's save()). Individual
--      staff can still be adjusted afterward in User Management.
--
-- Already applied directly to the live database this session (via
-- apply_migration, not blocked) -- Jeff doesn't need to run this himself,
-- it's here for the repo's own migration history.
alter table profiles add column if not exists can_view_roster_tab boolean not null default true;
alter table stores add column if not exists disable_roster boolean not null default false;
