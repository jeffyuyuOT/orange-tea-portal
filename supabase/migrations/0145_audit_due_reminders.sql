-- Jeff, 2026-10-26: "audit會跟隨紀錄，每四個月寄提醒message給admin，並且提前2個
-- 禮拜提醒，譬如Brisbane one 10/20有audit一次，那下一次audit應該是隔年2/20，所以
-- 在2/20前兩個禮拜寄message給admin提醒2/20會有audit".
-- Same day, changed: "改成前一個禮拜通知" — the reminder goes out 7 days before, not 14;
-- and "改成每3個月 audit 一次" — the interval is 3 months, not 4.
--
-- Per store with Audit switched on (stores.audit_enabled, migration 0123): the
-- next audit is due 3 months after that store's most recent audit (the latest
-- audit_date among reports that have been submitted — drafts don't count).
-- From 7 days before that due date, every active admin/developer gets ONE
-- in-app Message (same mechanism as the availability reminder, migration 0129;
-- sender is "System"). audit_due_reminders_sent remembers which due date has
-- already been reminded so the daily job never repeats itself; once a new audit
-- is done the due date moves 3 months on and the cycle starts again.
--
-- A store with no audit on record yet gets no reminder (there is nothing to
-- count 3 months from). If the due date has already passed with no new audit,
-- the reminder goes out once, worded "was due".
--
-- Runs daily at 23:00 UTC = 9am Brisbane (no DST), like the availability job.
-- To change the interval or lead time, edit the two constants below.

create table if not exists audit_due_reminders_sent (
  store_id  uuid not null references stores(id) on delete cascade,
  due_date  date not null,
  sent_at   timestamptz not null default now(),
  primary key (store_id, due_date)
);
-- Only the security-definer function below touches this table.
alter table audit_due_reminders_sent enable row level security;

create or replace function send_audit_due_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  interval_months constant int := 3;   -- how often an audit is due
  lead_days       constant int := 7;   -- remind this many days before
  today date := (now() at time zone 'Australia/Brisbane')::date;
  rec record;
  due date;
  subj text;
  body text;
  msg_id uuid;
begin
  if not exists (select 1 from profiles where role in ('admin', 'developer') and is_active) then
    return;
  end if;

  for rec in
    select
      s.id as store_id,
      s.name as store_name,
      (select max(r.audit_date) from audit_reports r where r.store_id = s.id and r.status <> 'draft') as last_audit
    from stores s
    where s.audit_enabled and s.is_active
  loop
    if rec.last_audit is null then
      continue;
    end if;

    due := (rec.last_audit + make_interval(months => interval_months))::date;

    if today < due - lead_days then
      continue;
    end if;

    if exists (select 1 from audit_due_reminders_sent x where x.store_id = rec.store_id and x.due_date = due) then
      continue;
    end if;

    subj := format('Audit reminder — %s — %s %s',
      rec.store_name,
      case when today > due then 'was due' else 'due' end,
      to_char(due, 'DD Mon YYYY'));

    body := format(
      '<p>The next audit for <strong>%s</strong> %s on <strong>%s</strong> (%s months after the last audit on %s).</p>',
      rec.store_name,
      case when today > due then 'was due' else 'is due' end,
      to_char(due, 'DD Mon YYYY'),
      interval_months,
      to_char(rec.last_audit, 'DD Mon YYYY')
    );

    insert into messages (store_id, sender_id, sender_name, subject, content_html)
    values (rec.store_id, null, 'System', subj, body)
    returning id into msg_id;

    insert into message_recipients (message_id, profile_id)
    select msg_id, p.id from profiles p where p.role in ('admin', 'developer') and p.is_active;

    insert into audit_due_reminders_sent (store_id, due_date) values (rec.store_id, due);
  end loop;
end;
$$;

revoke all on function send_audit_due_reminders() from public;

-- Same cron.schedule(name, ...) call replaces the job if it already exists.
select cron.schedule(
  'audit-due-reminder-daily',
  '0 23 * * *',
  $$select send_audit_due_reminders();$$
);
