-- Formal Quiz: a longer, stricter quiz (default 30 questions) alongside
-- the existing Quick Quiz in My Dashboard > Study Log. It mixes curated
-- multiple-choice questions from the Quiz Bank (the same pool Quick Quiz
-- draws from) with auto-generated "fill in the ingredient quantity"
-- questions built directly from Formula Database recipes (formula_item_
-- ingredients) — no separate authoring needed for those. Passing isn't
-- just "scored above X%": a manager/admin reviews the attempt in Learning
-- Tracker and ticks it as a pass, which is what makes that staff member
-- show as "Qualified".

-- Settings live in their own table (rather than adding a quiz_type column
-- to quiz_settings) since the two quiz types' settings shapes diverge —
-- formal quiz adds fill_in_blank_ratio — and this keeps each one simple,
-- same one-row-per-store shape as quiz_settings.
create table formal_quiz_settings (
  store_id            uuid primary key references stores(id) on delete cascade,
  question_count      integer not null default 30,
  importance_ratio    jsonb not null default '{"1":50,"2":30,"3":20}',
  -- % of the formal quiz made up of auto-generated formula fill-in-the-blank
  -- questions; the rest is drawn from the Quiz Bank as ordinary multiple
  -- choice, same as Quick Quiz.
  fill_in_blank_ratio integer not null default 20
);
alter table formal_quiz_settings enable row level security;
create policy "read formal_quiz_settings" on formal_quiz_settings for select using (auth.role() = 'authenticated');
create policy "admin write formal_quiz_settings" on formal_quiz_settings for all using (is_admin()) with check (is_admin());

-- quiz_attempts gains a type (default 'quick' so existing rows stay Quick
-- Quiz history) plus the manager/admin pass sign-off.
alter table quiz_attempts add column if not exists quiz_type text not null default 'quick' check (quiz_type in ('quick','formal'));
alter table quiz_attempts add column if not exists passed boolean not null default false;
alter table quiz_attempts add column if not exists passed_by uuid references profiles(id);
alter table quiz_attempts add column if not exists passed_at timestamptz;

-- There was no UPDATE policy on quiz_attempts at all before this — every
-- existing policy only covers select/insert. Needed now so a manager/admin
-- can tick the Pass checkbox in Learning Tracker.
create policy "manager admin update quiz_attempts" on quiz_attempts for update
  using (is_manager_or_admin())
  with check (is_manager_or_admin());

-- quiz_attempt_answers gains support for a fill-in-the-blank answer that
-- isn't backed by a quiz_questions row — fill-blank questions are built on
-- the fly from formula_item_ingredients each time a formal quiz is
-- generated, not curated/stored in the bank, so question_id (already
-- nullable) stays null for these and the question/answer are snapshotted
-- as plain text instead, for later review in Quiz History.
alter table quiz_attempt_answers add column if not exists question_type text not null default 'choice' check (question_type in ('choice','fill_blank'));
alter table quiz_attempt_answers add column if not exists question_text text;
alter table quiz_attempt_answers add column if not exists correct_answer_text text;
alter table quiz_attempt_answers add column if not exists answer_text text;
