-- Jeff, 2026-10-01: "如果roster hub裡的history有新增紀錄的話(更改不算)，
-- 包括未發布的紀錄，寄..通知給developer" — clarified afterwards (in chat,
-- when asked which email provider to use) that this should be an in-app
-- Message, same mechanism as migration 0084's Thursday reminder, not an
-- actual email: "應該是寄message給developer，不是email".
--
-- "新增紀錄(更改不算)" maps exactly onto how Manage Roster's Save/Submit
-- already writes roster_periods: migration 0027 changed it from "insert a
-- fresh row every click" to an UPSERT on the (store_id, week_start_date)
-- unique constraint (roster_periods_store_week_key) specifically so
-- re-saving the same week updates that one record instead of piling up
-- duplicates. That upsert shape is exactly what this trigger needs too —
-- Postgres only fires an AFTER INSERT trigger for the row actually
-- INSERTed; a save that lands on the UPSERT's ON CONFLICT DO UPDATE path
-- (i.e. re-saving/editing a week that already has a History record) takes
-- the UPDATE path instead and never reaches this trigger at all. So a
-- plain AFTER INSERT trigger already gets "new record only, edits don't
-- count" for free, with no extra bookkeeping needed. Fires for BOTH
-- draft and submitted status — no status filter — matching "包括未發布的
-- 紀錄".
--
-- One message, multiple recipients (every active developer) — same shape
-- ComposeMessageModal already uses for a multi-recipient send — rather
-- than one separate message per developer.
create or replace function notify_developers_on_new_roster_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  store_name text;
  subj text;
  msg_id uuid;
  dev_count int;
begin
  select name into store_name from stores where id = new.store_id;

  subj := format(
    'New roster record — %s — week of %s',
    coalesce(store_name, 'Unknown store'),
    to_char(new.week_start_date, 'DD Mon YYYY')
  );

  select count(*) into dev_count from profiles where role = 'developer' and is_active;
  if dev_count = 0 then
    return new;
  end if;

  insert into messages (store_id, sender_id, sender_name, subject, content_html)
  values (
    new.store_id,
    null,
    'System',
    subj,
    format(
      '<p>A new roster record was saved for %s, week of %s (status: %s).</p>',
      coalesce(store_name, 'Unknown store'),
      to_char(new.week_start_date, 'DD Mon YYYY'),
      new.status
    )
  )
  returning id into msg_id;

  insert into message_recipients (message_id, profile_id)
  select msg_id, id from profiles where role = 'developer' and is_active;

  return new;
end;
$$;

drop trigger if exists trg_notify_developers_on_new_roster_period on roster_periods;
create trigger trg_notify_developers_on_new_roster_period
  after insert on roster_periods
  for each row
  execute function notify_developers_on_new_roster_period();
