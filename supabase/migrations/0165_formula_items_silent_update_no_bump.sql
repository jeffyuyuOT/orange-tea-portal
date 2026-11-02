-- Jeff, 2026-11-02 (Silent Save follow-up): "還是有[收到通知]" — screenshot
-- showed the Formula sidebar red dot + "Update" tab still flagging
-- "Signature Milk Tea" after a Silent Save. Migration 0164 only taught the
-- PUSH trigger (notify_push_on_formula_update) to skip itself for a Silent
-- Save — it never touched `updated_at`, and the in-app "unseen update"
-- indicator (src/lib/formulaUpdates.js's getUnseenFormulaItems — the
-- Sidebar's red dot AND the Update tab's own list) is driven entirely by
-- `formula_items.updated_at`, nothing push-related at all. A content change
-- still legitimately bumped `updated_at` even with `silent_update: true`, so
-- every "unseen" check still correctly saw a newer timestamp than whatever
-- each person last viewed.
--
-- Jeff's own wording ("這種save方式就不會出現update提示，因為只是些許內容
-- 更改") makes clear Silent Save is meant to leave NO visible trace anywhere,
-- not just skip the phone push — so this re-defines the BEFORE UPDATE
-- trigger that decides `updated_at` (migration 0053, later touched by 0083's
-- is_must_know/top_10 exclusion and 0096's training_journey_phase one) to
-- pin `updated_at` to its old value whenever `silent_update` is true,
-- unconditionally — overriding the normal "did real content change" check
-- below it, not just adding another excluded column to that comparison.
-- That's deliberate: a Silent Save might genuinely change the name/recipe/
-- image, and it should still save — it just shouldn't count as a trackable
-- "update" for the push trigger (already handled, migration 0164), the
-- Sidebar red dot, or the Update tab, all three of which only ever look at
-- `updated_at`.
create or replace function set_formula_items_updated_at() returns trigger
language plpgsql as $$
begin
  if new.silent_update then
    new.updated_at := old.updated_at;
    return new;
  end if;

  if (to_jsonb(new) - 'updated_at' - 'is_must_know' - 'top_10' - 'training_journey_phase')
     = (to_jsonb(old) - 'updated_at' - 'is_must_know' - 'top_10' - 'training_journey_phase') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
