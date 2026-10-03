-- Jeff, 2026-10-04: "formula跟shop training的商品編輯頁面，出現必出勾選，
-- 勾選的話在formal exam, 和expert/master exam為必出考題" — a new
-- "Must Appear in Exam" flag, independent of is_must_know/top_10: when
-- checked, a question linked to this item is guaranteed a slot in the
-- Formal Exam and the Expert/Master Exam (NOT the Level-Up Exam, which
-- Jeff didn't mention and which only ever draws from must-know items
-- anyway) instead of leaving it purely to the random shuffle().slice()
-- every exam builder already ends with. See examBuilders.js's new
-- splitForced() helper for how this is actually enforced.
--
-- Already applied directly to the live DB (via apply_migration) as
-- "must_appear_in_exam" before this renumber — this file is the matching
-- repo copy, same as several other migrations already in this folder
-- whose applied DB name doesn't carry an 00NN prefix either.
alter table formula_items add column if not exists must_appear_in_exam boolean not null default false;
alter table shop_training_items add column if not exists must_appear_in_exam boolean not null default false;
