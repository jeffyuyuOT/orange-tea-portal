-- "Qualified" becomes an explicit, persisted flag on the staff member
-- instead of something derived fresh every time from
-- "has any Formal Quiz attempt been ticked passed=true" (StaffStudyDetail.jsx
-- / LearningTrackerPage.jsx, up to this point). Jeff wants a manager/admin
-- to be able to explicitly CANCEL a staff member's Qualified status — that
-- can't be expressed as a pure derivation from quiz_attempts.passed without
-- also having to go back and un-tick every past attempt, so it needs its
-- own column that only changes at two well-defined moments: (1) a
-- manager/admin ticks Pass on a Formal Quiz attempt for the first time, (2)
-- a manager/admin explicitly cancels it. See StaffStudyDetail.jsx.
alter table profiles
  add column if not exists qualified boolean not null default false,
  add column if not exists qualified_at timestamptz,
  add column if not exists qualified_by uuid references profiles(id);

-- Backfill: preserve today's derived "Qualified" status for everyone it
-- already applies to, so shipping this doesn't visually un-qualify anyone
-- who already earned it under the old (derived) rule. Uses each person's
-- most recently-passed Formal Quiz attempt for qualified_at/qualified_by,
-- which is the best available approximation of "when/by whom" for staff
-- who were already qualified before this column existed.
update profiles p
set qualified = true,
    qualified_at = latest.passed_at,
    qualified_by = latest.passed_by
from (
  select distinct on (profile_id) profile_id, passed_by, passed_at
  from quiz_attempts
  where quiz_type = 'formal' and passed = true
  order by profile_id, passed_at desc
) latest
where p.id = latest.profile_id;
