-- Jeff, 2026-11-02: "formula裡現有的商品編輯頁面裡,在save旁邊新增Silent Save
-- 的按鈕,以顏色跟原本save區隔。這種save方式就不會出現update提示,因為只是些許
-- 內容更改" — a "Silent Save" button (ItemEditModal.jsx) for a minor edit that
-- doesn't need to alert anyone via the push notification migration 0134 added.
--
-- `silent_update` just carries the button's choice into the same row the
-- update/insert already touches — ItemEditModal.jsx explicitly sets it to
-- `false` on a plain Save (not just omitting it), since a partial `.update()`
-- leaves a column alone when it's not in the payload and this would otherwise
-- stay silently stuck on `true` after one Silent Save.
alter table formula_items add column if not exists silent_update boolean not null default false;

-- Re-points the existing trigger (created in migration 0134) at this new
-- definition — same trigger, no need to drop/recreate it. One early return
-- added at the very top: a Silent Save skips the push even though the
-- content genuinely changed. `silent_update` is also stripped out of the
-- old/new comparison below it, same as sort_order/top_10_sort_order/
-- training_journey_phase/updated_at already were — otherwise merely
-- toggling it back to `false` on the next ordinary Save would itself look
-- like a content change and fire a notification for nothing.
create or replace function notify_push_on_formula_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_profile_ids uuid[];
  v_has_restrictions boolean;
  v_old_content jsonb;
  v_new_content jsonb;
  v_name text;
begin
  if new.silent_update then
    return null; -- Jeff, 2026-11-02: deliberate "Silent Save" — never push for this one
  end if;

  if not new.is_active or new.hide_from_formula or new.updated_at < new.tracked_since then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_old_content := to_jsonb(old) - 'sort_order' - 'top_10_sort_order' - 'training_journey_phase' - 'updated_at' - 'silent_update';
    v_new_content := to_jsonb(new) - 'sort_order' - 'top_10_sort_order' - 'training_journey_phase' - 'updated_at' - 'silent_update';
    if v_old_content = v_new_content then
      return null; -- only sort/phase/silent-flag bookkeeping changed — not a real content edit
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
      'url', '/operations-training/formula'
    )
  );
  return null;
exception when others then
  return null; -- never block the save on a push failure
end;
$$;
