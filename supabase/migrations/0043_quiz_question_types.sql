-- Quiz Bank: a question can now be Single choice, Multiple choice (more
-- than one correct answer), or Fill in the blank — previously every
-- question was hardcoded to exactly one correct_choice out of 4 choices.
--
-- Every existing row keeps working exactly as before: question_type
-- defaults to 'single', the only type that reads choices/correct_choice
-- the old way, and nothing existing is dropped, renamed, or backfilled
-- differently. (See the "⚠️⚠️" roster_display_name incident earlier in
-- this project's history for why that caution matters here.)
alter table quiz_questions
  add column if not exists question_type text not null default 'single'
    check (question_type in ('single', 'multi', 'fill_blank')),
  -- 'multi' only: every correct key, e.g. {A,C} — correct_choice (single
  -- text) stays as-is for 'single' questions.
  add column if not exists correct_choices text[],
  -- 'fill_blank' only: the accepted answer an admin types when writing the
  -- question.
  add column if not exists answer_text text,
  -- 'fill_blank' only: extra accepted answers the admin lists for the same
  -- question — covers an abbreviation or alternate name that means the
  -- same thing (e.g. "OT" for "Orange Tea", "100%" for "Full Sugar") that
  -- there's no way for the app to infer on its own. Matched exactly (after
  -- normalizing) or within a small typo tolerance — see
  -- src/lib/answerMatching.js, used by both Quick Quiz and Formal Quiz
  -- grading.
  add column if not exists accepted_answers text[];

-- correct_choice was `not null` because every question used to be
-- single-choice; a 'multi' or 'fill_blank' question doesn't set it.
alter table quiz_questions alter column correct_choice drop not null;

alter table quiz_questions add constraint quiz_questions_type_fields_chk check (
  (question_type = 'single' and correct_choice is not null) or
  (question_type = 'multi' and correct_choices is not null and array_length(correct_choices, 1) > 0) or
  (question_type = 'fill_blank' and answer_text is not null)
);

-- quiz_attempt_answers needs somewhere to record which choices were ticked
-- for a 'multi' question (a single selected_choice column isn't enough),
-- and its question_type check (added in migration 0033 for
-- 'choice'/'fill_blank' only, back when every bank question was
-- single-choice) needs to allow 'multi' too.
alter table quiz_attempt_answers add column if not exists selected_choices text[];

alter table quiz_attempt_answers drop constraint if exists quiz_attempt_answers_question_type_check;
alter table quiz_attempt_answers add constraint quiz_attempt_answers_question_type_check
  check (question_type in ('choice', 'multi', 'fill_blank'));
