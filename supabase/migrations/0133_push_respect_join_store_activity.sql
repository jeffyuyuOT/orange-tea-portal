-- Jeff, 2026-10-21: "如果user沒有勾join store activity，也不用推送通知跟小
-- 紅點提示訊息，因為這種user一般不需要積極看店內的發布訊息...2d maker跟
-- accountant可以變成預設join store activity不勾選，就不會收到任何訊息通知"
--
-- join_store_activity (profiles column, migration 0064/0067) already governs
-- whether someone counts as an "active store member" for Manage Roster /
-- Roster Staff Order / Staff Information / Learning Tracker / leave requests
-- (isActiveStoreMember(), src/lib/storeVisibility.js) — this extends the same
-- flag to the two store-scoped push triggers:
--   * notify_push_on_announcement — alongside the role exclusion already
--     added in 0132, now also skips anyone with join_store_activity = false.
--   * notify_push_on_roster_change — a roster-update push only makes sense
--     for someone who counts as an active member of that roster in the first
--     place, same rule the rest of the app already applies.
-- notify_push_on_message is deliberately left alone: a message is addressed
-- to specific, individually-chosen recipients (ComposeMessageModal), not
-- broadcast by store membership, so "not an active store member" isn't a
-- reason to swallow a message someone was personally sent.
--
-- The in-app red-dot side of this (AuthContext.jsx's refreshBulletinUpdates,
-- which already combines the Bulletin + roster-update signal) is handled
-- client-side in the same commit — see AuthContext.jsx.
create or replace function notify_push_on_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_ids uuid[];
  v_body text;
begin
  select array_agg(distinct s.profile_id) into v_profile_ids
  from (
    select profile_id from user_stores where store_id = new.store_id
    union
    select id as profile_id from profiles where primary_store_id = new.store_id
  ) s
  join profiles pr on pr.id = s.profile_id
  where pr.role not in ('training', 'qr_code_maker', 'accountant')
    and pr.join_store_activity;

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

create or replace function notify_push_on_roster_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_ids uuid[];
begin
  select array_agg(distinct nr.profile_id) into v_profile_ids
  from new_rows nr
  join profiles p on p.id = nr.profile_id
  where p.join_store_activity;

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
