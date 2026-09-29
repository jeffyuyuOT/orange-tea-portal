-- Jeff, 2026-09: merging Quiz Bank into the new "Training Centre" section
-- alongside Shop Training Database, with the same per-store-ownership +
-- "Copy to store…" model Shop Training Database already has (migration
-- 0052) — "quiz bank一樣會有分店的切換區別...不同分店設定可能不一樣"; quiz
-- generation itself ("出題的時候也會依照各分店的題庫去抓題") now needs to
-- draw only from the current store's own questions too.
--
-- This is the exact same transformation 0052 did to shop_training_items,
-- applied to quiz_questions: existing questions are backfilled into every
-- store they were already visible at (all active stores if unrestricted,
-- or the stores in quiz_question_stores if restricted), keeping the
-- original row/id for one arbitrarily-picked store (quiz_attempt_answers.
-- question_id is ON DELETE SET NULL, so this isn't strictly required to
-- avoid an error, but it keeps historical quiz-answer detail pointing at a
-- real row instead of going null for no reason) and inserting fresh
-- duplicate rows for every other target store. quiz_question_stores is
-- then dropped — a visibility restriction list no longer means anything
-- once content is store-owned outright.
--
-- Jeff, 2026-09 (retry after first attempt failed): wrapped in a single DO
-- block — running this as separate top-level statements hit
-- "relation "question_targets" does not exist" when the temp table created
-- by the first statement wasn't visible to the statements after it (most
-- likely only part of the script got sent/run as one execution — the SQL
-- Editor can do this if only some of the text is selected when you hit
-- Run). A DO block is a single statement from the server's point of view,
-- so as long as you select/paste this whole file and run it once, every
-- statement inside runs in the same session, back to back, no matter how
-- the editor would otherwise have split a bare list of statements. Select
-- the ENTIRE file (Ctrl+A in the SQL Editor) before running.
do $$
begin

create temporary table question_targets as
select q.id as question_id, s.id as store_id
from quiz_questions q
join quiz_question_stores qqs on qqs.question_id = q.id
join stores s on s.id = qqs.store_id
union
select q.id as question_id, s.id as store_id
from quiz_questions q
cross join stores s
where s.is_active
  and not exists (select 1 from quiz_question_stores qqs2 where qqs2.question_id = q.id);

create temporary table keep_choice as
select distinct on (question_id) question_id, store_id as keep_store_id
from question_targets
order by question_id, store_id;

alter table quiz_questions add column if not exists store_id uuid references stores(id) on delete cascade;

update quiz_questions q
set store_id = k.keep_store_id
from keep_choice k
where k.question_id = q.id;

create temporary table new_question_map as
select t.question_id as source_question_id, t.store_id as target_store_id, gen_random_uuid() as new_question_id
from question_targets t
join keep_choice k on k.question_id = t.question_id
where t.store_id <> k.keep_store_id;

insert into quiz_questions
  (id, group_key, category_id, formula_item_id, shop_training_item_id, question, choices, correct_choice,
   importance, created_by, created_by_name, question_type, correct_choices, answer_text, accepted_answers,
   image_path, store_id)
select
  m.new_question_id,
  q.group_key,
  q.category_id,
  q.formula_item_id,
  -- A shop_training-linked question's source item is itself store-owned
  -- (0052) — the duplicate at another store should point at THAT store's
  -- own copy of the same title if one exists, not the source store's item;
  -- falls back to null (same as "not found") if no matching title exists
  -- at the target store.
  (
    select ti2.id from shop_training_items ti1
    join shop_training_items ti2 on ti2.title = ti1.title and ti2.store_id = m.target_store_id
    where ti1.id = q.shop_training_item_id
    limit 1
  ),
  q.question,
  q.choices,
  q.correct_choice,
  q.importance,
  q.created_by,
  q.created_by_name,
  q.question_type,
  q.correct_choices,
  q.answer_text,
  q.accepted_answers,
  q.image_path,
  m.target_store_id
from new_question_map m
join quiz_questions q on q.id = m.source_question_id;

drop table question_targets;
drop table keep_choice;
drop table new_question_map;

alter table quiz_questions alter column store_id set not null;
create index if not exists idx_quiz_questions_store_id on quiz_questions(store_id);

drop table if exists quiz_question_stores;

end $$;

-- RLS: same store-scoped pattern as shop_training_items (migration 0052) —
-- read used to be wide open to any authenticated user (it was one shared
-- global bank), now scoped per store like everything else store-owned.
-- Left outside the DO block — CREATE/DROP POLICY works fine inside one too,
-- but there's no reason to bundle it in; keeping it separate means a
-- second run after the block above already succeeded won't need to redo
-- the (fast, idempotent) RLS statements as part of the same all-or-nothing
-- unit as the (slower, one-shot) data migration above.
drop policy if exists "admin write quiz_questions" on quiz_questions;
drop policy if exists "read quiz_questions" on quiz_questions;

create policy "read quiz_questions" on quiz_questions
  for select using (store_id = any (current_store_ids()) or is_admin());

create policy "manager admin write quiz_questions" on quiz_questions
  for all
  using ((is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin())
  with check ((is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin());
