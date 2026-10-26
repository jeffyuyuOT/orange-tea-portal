-- Jeff, 2026-10-26: "如果該項服務頻率是一個月的話，到期時寄message給shop manager
-- 跟developer，如果是一個月以上的，到期前一個禮拜那訊息提醒".
--
-- Maintenance Log (migration 0146): each item is due `frequency_months` after
-- the last time it was recorded as done (or after the day the item was added,
-- if never done). A daily job sends ONE in-app System message per item per due
-- date:
--   * Monthly (1 month)      -> on the due date itself
--   * Longer than 1 month    -> 7 days before the due date
-- If the job missed that day, it still sends on the next run (anything already
-- past its send day and not yet reminded). Recipients: the active shop
-- managers of that item's store plus every active developer. Once the service
-- is recorded the due date moves on and a new cycle starts.
--
-- Runs daily at 23:00 UTC = 9am Brisbane (no DST), like the audit job.
-- To change the lead time, edit lead_days below.

create table if not exists maintenance_due_reminders_sent (
  item_id   uuid not null references maintenance_items(id) on delete cascade,
  due_date  date not null,
  sent_at   timestamptz not null default now(),
  primary key (item_id, due_date)
);
-- Only the security-definer function below touches this table.
alter table maintenance_due_reminders_sent enable row level security;

create or replace function send_maintenance_due_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_days constant int := 7;   -- for services longer than monthly
  today date := (now() at time zone 'Australia/Brisbane')::date;
  rec record;
  due date;
  send_from date;
  subj text;
  body text;
  msg_id uuid;
begin
  for rec in
    select
      i.id as item_id,
      i.name as item_name,
      i.frequency_months,
      i.store_id,
      s.name as store_name,
      coalesce(
        (select max(l.done_date) from maintenance_logs l where l.item_id = i.id),
        (i.created_at at time zone 'Australia/Brisbane')::date
      ) as base_date
    from maintenance_items i
    join stores s on s.id = i.store_id
    where s.is_active
  loop
    due := (rec.base_date + make_interval(months => rec.frequency_months))::date;
    send_from := case when rec.frequency_months = 1 then due else due - lead_days end;

    if today < send_from then
      continue;
    end if;

    if exists (select 1 from maintenance_due_reminders_sent x where x.item_id = rec.item_id and x.due_date = due) then
      continue;
    end if;

    subj := format('Maintenance reminder — %s — %s %s',
      rec.item_name,
      case when today > due then 'was due' else 'due' end,
      to_char(due, 'DD Mon YYYY'));

    body := format(
      '<p><strong>%s</strong> at <strong>%s</strong> %s on <strong>%s</strong> (every %s). Please record it in Operations &amp; Training &gt; Maintenance Log once it is done.</p>',
      rec.item_name,
      rec.store_name,
      case when today > due then 'was due' else 'is due' end,
      to_char(due, 'DD Mon YYYY'),
      case when rec.frequency_months = 1 then 'month' else rec.frequency_months || ' months' end
    );

    -- Nobody to tell: skip without marking it sent, so it goes out once
    -- someone is assigned.
    if not exists (
      select 1 from profiles p
      where p.is_active and (
        p.role = 'developer'
        or (p.role = 'shop_manager' and (
          p.primary_store_id = rec.store_id
          or exists (select 1 from user_stores us where us.profile_id = p.id and us.store_id = rec.store_id)
        ))
      )
    ) then
      continue;
    end if;

    insert into messages (store_id, sender_id, sender_name, subject, content_html)
    values (rec.store_id, null, 'System', subj, body)
    returning id into msg_id;

    insert into message_recipients (message_id, profile_id)
    select msg_id, p.id
    from profiles p
    where p.is_active and (
      p.role = 'developer'
      or (p.role = 'shop_manager' and (
        p.primary_store_id = rec.store_id
        or exists (select 1 from user_stores us where us.profile_id = p.id and us.store_id = rec.store_id)
      ))
    );

    insert into maintenance_due_reminders_sent (item_id, due_date) values (rec.item_id, due);
  end loop;
end;
$$;

revoke all on function send_maintenance_due_reminders() from public;

-- Same cron.schedule(name, ...) call replaces the job if it already exists.
select cron.schedule(
  'maintenance-due-reminder-daily',
  '0 23 * * *',
  $$select send_maintenance_due_reminders();$$
);
