-- A Pending staff entry's own name (roster_pending_staff.display_name) is
-- its "original" identity — same role as a real profile's first/last name
-- in User Management. This adds the same roster-only override real staff
-- already have via profiles.roster_display_name, so Name display can show
-- "original name -> name shown on roster" for pending people too, without
-- renaming the underlying identity used for import/save name-matching
-- unless the manager actually means to.
alter table roster_pending_staff add column if not exists roster_display_name text;
