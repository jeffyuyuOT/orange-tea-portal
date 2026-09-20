-- formula_item_ingredients.ingredient_id had no ON DELETE behavior (default
-- NO ACTION), so deleting an in-use ingredient from Ingredient Master
-- actually failed outright with a foreign-key violation — silently, since
-- IngredientMasterTab's remove() never checked for an error. That
-- contradicted its own confirm-dialog copy ("Formulas referencing it will
-- lose the reference"), which assumed a clean removal. Switching to SET
-- NULL makes that promise true: the ingredient row disappears from any
-- formula that used it — FormulaItemDetail.jsx already filters out
-- ingredient rows with no ingredient_id, so this degrades to "no visible
-- change other than that ingredient no longer being listed", not a broken
-- row. See chat discussion 2026-09-20 (Ingredient Master delete-confirm
-- dialog).
alter table formula_item_ingredients drop constraint if exists formula_item_ingredients_ingredient_id_fkey;
alter table formula_item_ingredients
  add constraint formula_item_ingredients_ingredient_id_fkey
  foreign key (ingredient_id) references ingredient_master(id) on delete set null;
