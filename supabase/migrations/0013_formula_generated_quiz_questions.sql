-- Lets Quick Quiz mix in auto-generated "what's the quantity of this
-- ingredient" questions, built on the fly from formula_item_ingredients,
-- alongside the curated Quiz Bank questions — see chat discussion
-- 2026-09-20. No new table for the generated questions themselves: there's
-- nothing to curate, they're built fresh from formula_item_ingredients
-- every time a Quick Quiz is taken.

-- % of each Quick Quiz that should be auto-generated formula questions;
-- the rest comes from the curated quiz_questions bank, split by
-- importance_ratio as before. Default 0 = feature off (existing quiz
-- behaviour unchanged) until an admin turns this up in Quiz Bank > Setting.
alter table quiz_settings
  add column if not exists formula_question_ratio integer not null default 0
    check (formula_question_ratio between 0 and 100);

-- An auto-generated question has no row in quiz_questions, so
-- quiz_attempt_answers needs its own snapshot of what was asked to still
-- render correctly in Quiz History afterwards (question_id stays null for
-- these rows).
alter table quiz_attempt_answers
  add column if not exists is_generated boolean not null default false,
  add column if not exists generated_question text,
  add column if not exists generated_choices jsonb,
  add column if not exists generated_correct_choice text;
