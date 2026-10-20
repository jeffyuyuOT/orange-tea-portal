-- Jeff, 2026-10-21: "確認一下2d maker跟accountant不會收到推播通知" — checked
-- all three push triggers against NON_PICKABLE_STAFF_ROLES (training,
-- qr_code_maker, accountant — none of which have dashboard.bulletin or
-- dashboard.my_information access at all, permissions.js):
--   * notify_push_on_message: already safe — every recipient-picking path in
--     ComposeMessageModal.jsx already excludes NON_PICKABLE_STAFF_ROLES, so
--     these roles can never end up in message_recipients in the first place.
--   * notify_push_on_roster_change: already safe in practice — confirmed via
--     query, none of these roles has ever had a roster_change_events row
--     (they're not scheduled staff to begin with).
--   * notify_push_on_announcement: NOT safe — it resolves targets straight
--     from user_stores/profiles.primary_store_id with no role filter at
--     all, so an accountant (who has real user_stores rows, for the stores
--     they do bookkeeping on) or a qr_code_maker/training account would be
--     included, with no Bulletin Board page to even open the push's link.
--     Currently harmless only because none of them has ever subscribed
--     (push_subscriptions, confirmed empty for all of them) — not because
--     anything stops it. The nudge banner (AppShell.jsx) doesn't gate by
--     role, so that was one tap away from no longer being harmless.
-- This closes the gap at the source, same exclusion list as everywhere
-- else: a role filter here holds even if a subscription exists through some
-- future path this session didn't anticipate.
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
  where pr.role not in ('training', 'qr_code_maker', 'accountant');

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
