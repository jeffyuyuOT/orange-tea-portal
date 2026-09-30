-- Thursday availability reminder — Jeff, 2026-10-01: "如果到禮拜四都還沒輸
-- 入my availabilty的話，系統會寄message提示還未輸入my availability time，
-- 請盡速處理的訊息" — every Thursday morning, anyone roster-eligible who
-- still has NO availability_days rows for NEXT week gets a real in-app
-- Message (not the Bulletin "computed, not stored, recalculated on every
-- page load" reminder pattern quiz_reminder/training-hours use — Jeff said
-- "寄message" specifically, which in this app means an actual
-- messages/message_recipients row that shows up in the Message inbox).
--
-- "還沒輸入" is deliberately read literally as "zero rows for next week",
-- not "their computed availability happens to be the all-available
-- default" — availability_days' own design (migration 0063) already makes
-- "no row for a day" mean "fully available all day", which is a valid,
-- intentional state once someone HAS opened the page and started
-- declaring some days. This reminder exists to get people who haven't
-- opened My Availability at all for next week to go in and actually
-- declare it, not to flag an already-complete "all available" week as
-- incomplete.
--
-- Roster-eligible mirrors the same definition ManageRosterPage.jsx's staff
-- list and NON_ROSTER_STAFF_ROLES (permissions.js) already use: active,
-- not training/qr_code_maker/accountant, and an active member of at least
-- one store (profiles.join_store_activity, migration 0064/0067 — applies
-- uniformly to primary and "also belong to" stores alike now).
create extension if not exists pg_cron;

create or replace function send_next_week_availability_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_week date := (date_trunc('week', (now() at time zone 'Australia/Brisbane'))::date + 7);
  subj text;
  rec record;
  msg_id uuid;
begin
  -- Queensland (Sunnybank, Toowong, ...) has no daylight saving, so "next
  -- Monday" computed off Brisbane local time is stable year-round — this
  -- matches rosterWeeks.js's nextWeekStart() (Monday-start week, +7 days),
  -- just computed here in SQL since the cron job has no access to that JS
  -- helper.
  subj := 'Please enter your availability for the week of ' || to_char(next_week, 'DD Mon YYYY');

  for rec in
    select
      p.id as profile_id,
      coalesce(p.primary_store_id, (select us.store_id from user_stores us where us.profile_id = p.id limit 1)) as store_id
    from profiles p
    where p.is_active
      and p.role not in ('training', 'qr_code_maker', 'accountant')
      and p.join_store_activity
      and (
        p.primary_store_id is not null
        or exists (select 1 from user_stores us where us.profile_id = p.id)
      )
      and not exists (
        select 1 from availability_days ad
        where ad.profile_id = p.id and ad.week_start_date = next_week
      )
      and not exists (
        -- Idempotency guard: don't re-send this same week's reminder to the
        -- same person twice, in case the job is ever re-run or fired again
        -- by hand the same week.
        select 1
        from message_recipients mr
        join messages m on m.id = mr.message_id
        where mr.profile_id = p.id and m.subject = subj and m.sender_id is null
      )
  loop
    if rec.store_id is null then
      continue;
    end if;

    insert into messages (store_id, sender_id, sender_name, subject, content_html)
    values (
      rec.store_id,
      null,
      'System',
      subj,
      '<p>You haven''t entered your availability for next week yet. Please fill in My Availability as soon as possible.</p>'
    )
    returning id into msg_id;

    insert into message_recipients (message_id, profile_id) values (msg_id, rec.profile_id);
  end loop;
end;
$$;

-- Thursday 9:00am Brisbane (AEST, fixed UTC+10 — no DST) = Wednesday 23:00
-- UTC. pg_cron's day-of-week uses the same 0=Sunday..6=Saturday convention
-- as Postgres' own EXTRACT(dow ...), so Wednesday = 3.
select cron.schedule(
  'thursday-availability-reminder',
  '0 23 * * 3',
  $$select send_next_week_availability_reminders();$$
);
