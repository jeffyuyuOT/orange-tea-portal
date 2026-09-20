-- Optional image attached to a formula item's Notes — for things that are
-- genuinely easier to show than to type out (a reference/lookup chart like
-- "SA/TAM MT", a photo of an unusual topping layout, etc). Shown under the
-- Notes text on the staff-facing Formula page when present.
alter table formula_items add column if not exists notes_image_path text;
