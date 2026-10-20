-- Jeff, 2026-10-21 (point 1): "Roster hub裡的setting裡新增message reminder分
-- 頁，裡面可以設置禮拜幾之前員工如果沒有apply下禮拜的available time會收到系
-- 統訊息提醒。之前是預設禮拜四，現在統一由這裡設定(不同分店會有不同的設定)，
-- 一樣有勾取lock time pattern的員工不會收到訊息" — the Thursday reminder
-- (migration 0084) was hardcoded to one weekday for every store. This makes
-- it a per-store setting (Roster Hub > Setting > Message reminder), default
-- Thursday (4, Postgres EXTRACT(dow) convention: 0=Sunday) so every existing
-- store's behavior is unchanged until someone picks a different day.
--
-- The "locked availability pattern" exclusion (migrations 0087/0088) needs
-- no change at all — it already works purely off "does next week have an
-- availability_days row yet", which stays true regardless of which weekday
-- triggers the check.
alter table stores
  add column if not exists availability_reminder_weekday smallint not null default 4
  check (availability_reminder_weekday between 0 and 6);

-- send_next_week_availability_reminders() used to be scheduled on ONE fixed
-- weekday (Wednesday 23:00 UTC = Thursday 9am Brisbane) for every store. Now
-- that the trigger day is per-store, the job itself runs every day at the
-- same time, and the function filters each profile by whether TODAY
-- (Brisbane) matches THEIR store's configured day.
create or replace function send_next_week_availability_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_week date := (date_trunc('week', (now() at time zone 'Australia/Brisbane'))::date + 7);
  today_dow smallint := extract(dow from (now() at time zone 'Australia/Brisbane'))::smallint;
  subj text;
  rec record;
  msg_id uuid;
begin
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
        select 1
        from message_recipients mr
        join messages m on m.id = mr.message_id
        where mr.profile_id = p.id and m.subject = subj and m.sender_id is null
      )
      and exists (
        select 1 from stores s
        where s.id = coalesce(p.primary_store_id, (select us2.store_id from user_stores us2 where us2.profile_id = p.id limit 1))
          and s.availability_reminder_weekday = today_dow
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

-- Was 'thursday-availability-reminder' at '0 23 * * 3' (Wednesday 23:00 UTC
-- only). Daily now, same time of day (23:00 UTC = 9am Brisbane, no DST) —
-- the function above is what actually decides who gets a message each day.
select cron.unschedule('thursday-availability-reminder');
select cron.schedule(
  'availability-reminder-daily',
  '0 23 * * *',
  $$select send_next_week_availability_reminders();$$
);
