-- Jeff, 2026-10-03: "將商品mark為top 10或must know item不用有update提示，我記得
-- 之前有做過了，剛剛試了還是有出現update提示" -- migration 0083 widened
-- formula_items' updated_at trigger to ignore is_must_know changes, but left
-- top_10 out of that exclusion list, so toggling the ⭐ Top 10 checkbox
-- (ItemEditModal) alone still bumped updated_at and lit up everyone's
-- Formula "Update" tab/Sidebar badge (migration 0053) just like a real
-- recipe edit would -- that's the "還是有出現update提示" Jeff just hit.
--
-- Widening the same jsonb diff in set_formula_items_updated_at() (0083) to
-- also strip 'top_10' closes this the same way, for the same reason: a
-- pure flag toggle isn't a recipe/content change. CREATE OR REPLACE is
-- enough -- the trigger (0083) already points at this function by name, so
-- no DROP/recreate of the trigger itself is needed.
create or replace function set_formula_items_updated_at() returns trigger as $$
begin
  if (to_jsonb(NEW) - 'updated_at' - 'is_must_know' - 'top_10') = (to_jsonb(OLD) - 'updated_at' - 'is_must_know' - 'top_10') then
    NEW.updated_at := OLD.updated_at;
  else
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$ language plpgsql;
