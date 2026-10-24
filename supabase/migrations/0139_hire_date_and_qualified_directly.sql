-- Jeff, 2026-10-24: two related Staff Information / Learning Tracker
-- requests in one message:
--
-- 1. "員工入職時間系統會直接填這名員工第一次打卡的日期，但還是可以手動更改"
--    — Hire date (profiles.hire_date, migration 0001/edited from
--    StaffDetailModal.jsx) auto-fills from a staff member's very first
--    clock_in event instead of starting blank and needing a manager to type
--    it in by hand. "還是可以手動更改" (still manually changeable) is why the
--    trigger below only ever fires when hire_date IS NULL — once it's set,
--    by the trigger or by a manager typing it in directly, nothing here ever
--    touches it again, including if a later clock_in happens to be the
--    first one chronologically for some reason (backfilled data, etc).
--
-- 2. "如果直接標記為qualified的員工則入職日期下會註明圖示...This is a senior
--    staff member. The date shown is the system start date, not the
--    official hire date." — StaffStudyDetail.jsx's markQualified() (Mark as
--    Qualified, bypassing a Formal Quiz review — Jeff's own words on that
--    button: "e.g. an experienced hire") is exactly the "this person joined
--    already fully trained, possibly well after their REAL hire date
--    elsewhere" case where an auto-filled "first clock-in" hire date would
--    be misleading. qualified_marked_directly records that this profile had
--    Qualified granted that way at least once, so StaffDetailModal.jsx can
--    show the warning icon next to Hire date. Deliberately only set by
--    markQualified(), never by togglePass()'s ordinary Formal-Quiz-Pass
--    grant (a normal trainee progressing through the system the regular
--    way) — and never cleared again (cancelQualified etc.), since it's a
--    historical fact about how this person joined, not a live status.
alter table profiles add column if not exists qualified_marked_directly boolean not null default false;

create or replace function set_hire_date_from_first_clock_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type <> 'clock_in' then
    return new;
  end if;

  update profiles
  set hire_date = (new.occurred_at at time zone 'Australia/Brisbane')::date
  where id = new.profile_id
    and hire_date is null
    -- Only when this is genuinely the first clock_in this profile has ever
    -- had — not just "any clock_in while hire_date happens to be null"
    -- (e.g. a manager clearing hire_date back out later shouldn't let the
    -- next ordinary clock_in get mistaken for day one).
    and not exists (
      select 1 from attendance_events ae
      where ae.profile_id = new.profile_id
        and ae.event_type = 'clock_in'
        and ae.id <> new.id
    );

  return new;
end;
$$;

drop trigger if exists trg_set_hire_date_from_first_clock_in on attendance_events;
create trigger trg_set_hire_date_from_first_clock_in
after insert on attendance_events
for each row execute function set_hire_date_from_first_clock_in();
