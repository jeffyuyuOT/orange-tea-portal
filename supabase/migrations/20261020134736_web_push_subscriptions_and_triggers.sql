-- Jeff, 2026-10-21: full Web Push. push_subscriptions stores each
-- browser/device's PushSubscription; three AFTER INSERT triggers call the
-- send-push Edge Function via net.http_post, same pattern already used by
-- cleanup_profile_storage_files()/cleanup_sr_notify_delete() for
-- delete-storage-files (anon key as Authorization — not sensitive, already
-- ships in the client bundle; the Edge Function itself uses its own
-- service-role key internally).

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "own subscriptions" on push_subscriptions for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Message: batches every recipient from one compose (transition table
-- covers ComposeMessageModal's single multi-recipient insert and
-- notifyManagersOfTrainingHours()'s) into one push call per message.
create or replace function notify_push_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  for rec in
    select m.id as message_id, m.sender_name, m.subject, array_agg(distinct nr.profile_id) as profile_ids
    from new_rows nr
    join messages m on m.id = nr.message_id
    group by m.id, m.sender_name, m.subject
  loop
    if rec.profile_ids is not null and array_length(rec.profile_ids, 1) > 0 then
      perform net.http_post(
        url := 'https://rwstojuipeaaqdehqoqw.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3c3RvanVpcGVhYXFkZWhxb3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTcxODgsImV4cCI6MjEwNTEzMzE4OH0.c9N2jlLkTVeT3O_A-LnQDLXALspo6GJ2Ud2NiSE9TgA'
        ),
        body := jsonb_build_object(
          'profileIds', to_jsonb(rec.profile_ids),
          'title', coalesce(nullif(rec.sender_name, ''), 'OT Portal'),
          'body', coalesce(nullif(rec.subject, ''), '你有一則新訊息'),
          'url', '/dashboard/message'
        )
      );
    end if;
  end loop;
  return null;
exception when others then
  return null; -- never block the insert on a push failure
end;
$$;

create trigger trg_notify_push_on_message
after insert on message_recipients
referencing new table as new_rows
for each statement execute function notify_push_on_message();

-- Announcement: a multi-store broadcast is already N separate single-row
-- inserts from the client (AnnouncementDetailModal's loop), so per-row is
-- correct here, no batching needed.
create or replace function notify_push_on_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_profile_ids uuid[];
  v_body text;
begin
  select array_agg(distinct profile_id) into v_profile_ids
  from (
    select profile_id from user_stores where store_id = new.store_id
    union
    select id from profiles where primary_store_id = new.store_id
  ) s;

  if v_profile_ids is null or array_length(v_profile_ids, 1) = 0 then
    return null;
  end if;

  v_body := left(regexp_replace(coalesce(new.content_html, ''), '<[^>]+>', '', 'g'), 120);

  perform net.http_post(
    url := 'https://rwstojuipeaaqdehqoqw.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3c3RvanVpcGVhYXFkZWhxb3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTcxODgsImV4cCI6MjEwNTEzMzE4OH0.c9N2jlLkTVeT3O_A-LnQDLXALspo6GJ2Ud2NiSE9TgA'
    ),
    body := jsonb_build_object(
      'profileIds', to_jsonb(v_profile_ids),
      'title', coalesce(nullif(new.title, ''), 'Orange Tea 公告'),
      'body', coalesce(nullif(v_body, ''), '點進去看詳情'),
      'url', '/dashboard/bulletin'
    )
  );
  return null;
exception when others then
  return null;
end;
$$;

create trigger trg_notify_push_on_announcement
after insert on announcements
for each row execute function notify_push_on_announcement();

-- Roster: doPersist() inserts an array of changed profile_ids in one
-- statement, so batch via a transition table into one push call.
create or replace function notify_push_on_roster_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_profile_ids uuid[];
begin
  select array_agg(distinct profile_id) into v_profile_ids from new_rows;
  if v_profile_ids is null or array_length(v_profile_ids, 1) = 0 then
    return null;
  end if;

  perform net.http_post(
    url := 'https://rwstojuipeaaqdehqoqw.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3c3RvanVpcGVhYXFkZWhxb3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTcxODgsImV4cCI6MjEwNTEzMzE4OH0.c9N2jlLkTVeT3O_A-LnQDLXALspo6GJ2Ud2NiSE9TgA'
    ),
    body := jsonb_build_object(
      'profileIds', to_jsonb(v_profile_ids),
      'title', '班表更新',
      'body', '你的班表有異動，點進去看',
      'url', '/roster-hub/my-roster'
    )
  );
  return null;
exception when others then
  return null;
end;
$$;

create trigger trg_notify_push_on_roster_change
after insert on roster_change_events
referencing new table as new_rows
for each statement execute function notify_push_on_roster_change();
