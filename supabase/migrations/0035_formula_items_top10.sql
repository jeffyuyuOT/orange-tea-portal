-- "Top 10" is a lightweight, admin-toggleable flag on drink items (Admin
-- Center > Formula Database > edit a drink), not a real formula_categories
-- row — a drink keeps showing up in its own category too, and also shows up
-- gathered together under a synthetic "Top 10" category on the staff
-- Formula page (FormulaPage.jsx) and in the Study Log drink filter
-- (StudyLogList.jsx). Both places filter/group purely in the front end
-- (`.eq('top_10', true)` instead of `.eq('category_id', ...)`), so this is
-- the only schema change needed.
--
-- Memorized status doesn't need any special "sync" logic between the Top 10
-- view and a drink's own category view: it's still the same
-- formula_items.id, so there's only ever one study_progress row for it —
-- checking "Memorized" from either view updates that same row.
alter table formula_items add column if not exists top_10 boolean not null default false;

-- Only drink items can be Top 10 — Tea/Toppings/Others don't have this
-- category concept at all.
alter table formula_items drop constraint if exists formula_items_top_10_drink_only;
alter table formula_items add constraint formula_items_top_10_drink_only
  check (not top_10 or group_key = 'drink');
