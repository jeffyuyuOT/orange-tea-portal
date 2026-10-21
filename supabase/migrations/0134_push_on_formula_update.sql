-- Jeff, 2026-10-21: "formula更新有算在推播數字裡嗎" / "好" — adds Formula item
-- edits as a fourth source of real Web Push notifications, alongside
-- message/announcement/roster_change (migrations 0131/0132/0133). Until now
-- a formula edit only ever lit up the in-app red dot (AuthContext.jsx's
-- hasFormulaUpdates / getUnseenFormulaItems() / formulaUpdates.js) — on
-- Android that in-app dot never reaches the phone's own home-screen icon
-- badge at all (that badge comes entirely from a real push notification
-- sitting in the notification shade, see AppShell.jsx's 2026-10-21 comment),
-- so a formula change never moved the number staff actually see on their
-- icon. This closes that gap.
--
-- Eligibility (is_active / not hide_from_formula / updated_at bumped past
-- tracked_since) is copied verbatim from getUnseenFormulaItems() so this
-- fires for exactly the same edits that already light up the in-app dot —
-- see migration 0053's comment for why tracked_since makes this a no-op for
-- every pre-existing item.
--
-- The "did the content actually change" check below is NEW and deliberately
-- STRICTER than the in-app dot's own rule, for a reason unique to push:
-- ItemManager.jsx's drag-to-reorder (one UPDATE per row, for EVERY row in
-- the whole list, touching only sort_order/top_10_sort_order) and
-- PhaseItemTab.jsx's Training Journey phase assignment (training_journey_
-- phase only) both bump updated_at through the same set_updated_at trigger
-- ItemEditModal's real save() does — fine for a silent dot, but reordering
-- a 40-item list would otherwise fire 40 separate phone notifications at
-- everyone with Formula access for a purely administrative, cosmetic
-- change nobody asked to be told about. Comparing the row with those
-- columns (plus updated_at itself) stripped out means this only fires for
-- an actual name/recipe/category/image/visibility edit — i.e. a real save
-- from ItemEditModal — while the in-app dot's own looser rule is completely
-- untouched (still fires on a reorder/phase-only change, exactly as before).
--
-- Recipients mirror getUnseenFormulaItems()'s own store-visibility rule
-- (formula_item_stores — no rows = visible everywhere, rows = only those
-- stores), same role exclusion as every other push trigger (training/
-- qr_code_maker/accountant have no Formula page access at all — see
-- permissions.js ROLE_DEFAULTS) and the same join_store_activity gate
-- 0133 already applies to announcement/roster — formula updates are a
-- store-wide broadcast, not a message addressed to a specific person, same
-- category as those two.
create or replace function notify_push_on_formula_update() returns trigger
language plpgsql security definer set search_path = public as $$
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
      return null; -- only sort/phase bookkeeping changed — not a real content edit
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

create trigger trg_notify_push_on_formula_update
after insert or update on formula_items
for each row execute function notify_push_on_formula_update();
