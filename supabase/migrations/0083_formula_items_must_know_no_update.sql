-- Jeff, 2026-10-01: "將商品標註成must-know item可以不要算成更新嗎" -- flagging
-- a drink/tea/topping/other item's ⭐ Must Know Item checkbox (ItemEditModal,
-- is_must_know) shouldn't bump formula_items.updated_at, since that's what
-- the Formula "Update" tab (migration 0053) uses to flag "new or changed
-- content since you last looked" for every staff member -- a pure
-- must-know-flag toggle isn't a recipe/content change, so it shouldn't make
-- everyone's Update badge light up the way an actual recipe edit should
-- (see 2026-09-30's "拿掉這次因為做must-know item造成的update" clean-up --
-- this closes the same hole at the source instead of having to mop it up
-- again next time the flag changes).
--
-- The existing trg_formula_items_updated_at trigger (0001_init.sql) uses
-- the shared, generic set_updated_at() function that every other table's
-- updated_at trigger also uses -- that function can't be changed here, it
-- would affect every one of those other tables too -- so formula_items
-- gets its own dedicated trigger function instead. It compares the old and
-- new row as jsonb with 'updated_at' and 'is_must_know' stripped out of
-- both sides first: if what's left is identical, the ONLY thing that
-- changed was is_must_know (or nothing changed at all), so updated_at is
-- left exactly as it was; any other column changing still bumps it to
-- now(), same as before. Comparing this way (rather than listing every
-- other column by name) means it stays correct automatically if a column
-- is ever added to formula_items later.
create or replace function set_formula_items_updated_at() returns trigger as $$
begin
  if (to_jsonb(NEW) - 'updated_at' - 'is_must_know') = (to_jsonb(OLD) - 'updated_at' - 'is_must_know') then
    NEW.updated_at := OLD.updated_at;
  else
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_formula_items_updated_at on formula_items;
create trigger trg_formula_items_updated_at before update on formula_items
  for each row execute function set_formula_items_updated_at();
