-- Jeff, 2026-10-24: "執行完migration 0139，但入職日期還是沒有自動填入" — ran
-- 0139, hire date still isn't auto-filling. Checked: the column and trigger
-- from 0139 are both in place and enabled, so that part is fine. The real
-- gap: trg_set_hire_date_from_first_clock_in only ever fires on a NEW
-- clock_in INSERT, and only sets hire_date when this is genuinely that
-- profile's very FIRST clock_in ever (its "not exists any other clock_in"
-- guard). Every current staff member already has clock-in history from
-- before 0139 existed, so for every one of them that guard will always
-- fail from now on — the trigger was only ever going to help a brand-new
-- staff member clocking in for the first time AFTER 0139, never backfill
-- anyone already in the system. Confirmed via a direct query: 34 profiles
-- have hire_date null despite already having attendance_events clock_in
-- rows going back to late September.
--
-- One-time backfill: for every profile that still has no hire_date, set it
-- from the EARLIEST clock_in this profile has ever had, same Brisbane-date
-- conversion the trigger itself uses. Deliberately the same "only touch
-- hire_date IS NULL" guard as the trigger — anyone who already has a
-- hire_date (typed in by hand, or already set by the trigger for someone
-- new since 0139) is left untouched.
update profiles p
set hire_date = sub.first_clock_in_date
from (
  select profile_id, min((occurred_at at time zone 'Australia/Brisbane')::date) as first_clock_in_date
  from attendance_events
  where event_type = 'clock_in'
  group by profile_id
) sub
where p.id = sub.profile_id
  and p.hire_date is null;
