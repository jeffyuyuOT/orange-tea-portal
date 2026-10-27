-- Jeff, 2026-10-27: "推播提示在samsung手機常常會讀完，提示還是卡在那，必須
-- 要去setting-app-force stop後，提示才會消失" — none of these four triggers
-- were sending a `tag` in the push payload (send-push's edge function and
-- push-sw.js both already support one — see webPush.js/push-sw.js — it was
-- just never set at the source), so every push created a brand-new, never-
-- replaced Android notification instead of the same category's notification
-- being replaced in place. More piled-up notifications means more exposure
-- to the badge-count desync bug Samsung's One UI launcher is known for.
-- Giving each category its own stable tag at least means a second push of
-- the same kind replaces the first instead of stacking — see push-sw.js's
-- own follow-up change (explicit close-before-replace, already applied) for
-- the other half of this fix.

create or replace function public.notify_push_on_announcement()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      'url', '/dashboard/bulletin',
      'tag', 'announcement'
    )
  );
  return null;
exception when others then
  return null;
end;
$function$;

create or replace function public.notify_push_on_formula_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_profile_ids uuid[];
  v_has_restrictions boolean;
  v_old_content jsonb;
  v_new_content jsonb;
  v_name text;
begin
  if not new.is_active or new.hide_from_formula or new.updated_at < new.tracked_since then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_old_content := to_jsonb(old) - 'sort_order' - 'top_10_sort_order' - 'training_journey_phase' - 'updated_at';
    v_new_content := to_jsonb(new) - 'sort_order' - 'top_10_sort_order' - 'training_journey_phase' - 'updated_at';
    if v_old_content = v_new_content then
      return null;
    end if;
  end if;

  select exists(select 1 from formula_item_stores where formula_item_id = new.id) into v_has_restrictions;

  select array_agg(distinct s.profile_id) into v_profile_ids
  from (
    select profile_id, store_id from user_stores
    union
    select id as profile_id, primary_store_id as store_id from profiles where primary_store_id is not null
  ) s
  join profiles pr on pr.id = s.profile_id
  where pr.role not in ('training', 'qr_code_maker', 'accountant')
    and pr.join_store_activity
    and (not v_has_restrictions or s.store_id in (select store_id from formula_item_stores where formula_item_id = new.id));

  if v_profile_ids is null or array_length(v_profile_ids, 1) = 0 then
    return null;
  end if;

  v_name := coalesce(nullif(new.name_zh, ''), new.name_en, '配方項目');

  perform net.http_post(
    url := 'https://rwstojuipeaaqdehqoqw.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3c3RvanVpcGVhYXFkZWhxb3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTcxODgsImV4cCI6MjEwNTEzMzE4OH0.c9N2jlLkTVeT3O_A-LnQDLXALspo6GJ2Ud2NiSE9TgA'
    ),
    body := jsonb_build_object(
      'profileIds', to_jsonb(v_profile_ids),
      'title', '配方更新',
      'body', left(v_name, 60) || ' 有更新，點進去看',
      'url', '/operations-training/formula',
      'tag', 'formula_update'
    )
  );
  return null;
exception when others then
  return null;
end;
$function$;

create or replace function public.notify_push_on_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
          'url', '/dashboard/message',
          'tag', 'message'
        )
      );
    end if;
  end loop;
  return null;
exception when others then
  return null; -- never block the insert on a push failure
end;
$function$;

create or replace function public.notify_push_on_roster_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      'url', '/roster-hub/my-roster',
      'tag', 'roster_change'
    )
  );
  return null;
exception when others then
  return null;
end;
$function$;
