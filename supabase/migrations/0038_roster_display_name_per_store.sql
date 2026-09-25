-- Applied directly via Supabase MCP during this session. Saved here after
-- the fact for the repo's migration history.
--
-- MISTAKE — reverted by 0041_revert_roster_display_name_to_profiles.sql.
-- This was based on a stale read of the codebase that assumed display-name
-- editing still lived in a "Name display" tab under Roster Hub > Setting
-- (NameDisplayTab.jsx). In fact that had already been moved, in an earlier
-- session, into Shop Management > Staff Information (StaffDetailModal.jsx /
-- PendingStaffDetailModal.jsx), which write directly to
-- profiles.roster_display_name. Dropping that column broke every staff-info
-- save (not just display name), since StaffDetailModal's single update
-- payload always includes it. Kept here rather than deleted so the history
-- is honest; see 0041 for the fix.

alter table user_stores add column roster_display_name text;

update user_stores us
set roster_display_name = p.roster_display_name
from profiles p
where p.id = us.profile_id and p.roster_display_name is not null;

alter table profiles drop column roster_display_name;
