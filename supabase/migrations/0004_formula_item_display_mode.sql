-- Moves the Standard / Custom-image display choice up from each ingredient
-- row to the formula item itself: a drink is shown either as its list of
-- ingredient chips, or as one custom image for the whole item — not a
-- per-ingredient mix (that's what the admin edit screen used to offer).
-- The old per-row formula_item_ingredients.display_mode / custom_image_path
-- columns are left in place (still default 'standard' / null) but are no
-- longer read or written by the app.
alter table formula_items
  add column if not exists display_mode text not null default 'standard' check (display_mode in ('standard','custom')),
  add column if not exists custom_image_path text;
