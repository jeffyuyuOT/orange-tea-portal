-- Jeff, 2026-09: "要把目前branch的quiz都移到admin quiz bank裡，然後branch
-- quiz bank就會先清空，因為這些都是之前從admin setting下的quiz bank移過去
-- 的" — every existing Formula-related (group_key drink/tea/toppings/others)
-- quiz_questions row becomes an admin-authored, shared question
-- (store_id = null); every store's Branch Quiz Bank starts out empty.
--
-- Migration 0071 turned one shared bank into a store-owned one by
-- DUPLICATING each question into every store that could see it (new id per
-- store, same content) — so most of what's in the branch banks today is
-- several byte-identical copies of what used to be one shared question.
-- Jeff confirmed (asked directly, since this is a real data decision):
-- identical duplicates should be merged back into ONE row before moving to
-- the admin bank, not kept as repeats — otherwise the reinstated Admin Quiz
-- Bank would show the same question 3-5 times over. A row with no
-- duplicate (unique to one store — genuinely new content authored after
-- 0071, or a question a store edited differently since) still moves to the
-- admin bank on its own; Jeff's instruction was unconditional ("都移到"),
-- not "only the duplicates".
--
-- group_key = 'shop_training' rows are the one deliberate exception, LEFT
-- ALONE by this whole migration (not deduped, not moved): unlike
-- formula_items (global/shared), shop_training_items are store-owned
-- outright (migration 0052) — every store has its own copy of a training
-- item under its own id, even for the "same" title. A shop_training-linked
-- quiz question's shop_training_item_id always points at ONE specific
-- store's own item row, so it can never actually mean "shared with every
-- store" the way a formula-linked question can — setting its store_id to
-- null would just orphan it (AdminQuestionsTab.jsx deliberately has no
-- "shop_training" group, and it would also disappear from every store's
-- Branch bank at the same time, since that queries by store_id). Formula
-- questions (which Jeff was actually asking about — Quiz Bank Setting's
-- Importance Mix and this whole reinstated-bank concept are Formula/drink-
-- centric) don't have this problem, since formula_items are the same row
-- for every store.
do $$
begin

create temporary table dup_groups as
select
  id,
  created_at,
  row_number() over (
    partition by
      category_id, formula_item_id, question, choices, correct_choice,
      correct_choices, answer_text, accepted_answers, importance, question_type, image_path
    order by created_at asc, id asc
  ) as rn,
  first_value(id) over (
    partition by
      category_id, formula_item_id, question, choices, correct_choice,
      correct_choices, answer_text, accepted_answers, importance, question_type, image_path
    order by created_at asc, id asc
  ) as keep_id
from quiz_questions
where group_key <> 'shop_training';

-- Repoint any historical Quiz History reference from a row about to be
-- dropped as a duplicate to the one row in its group being kept, so old
-- attempts still show real question detail instead of the reference going
-- null (quiz_attempt_answers.question_id is ON DELETE SET NULL — without
-- this it would silently lose that detail the moment the duplicate rows
-- below are deleted).
update quiz_attempt_answers a
set question_id = d.keep_id
from dup_groups d
where a.question_id = d.id
  and d.rn > 1;

delete from quiz_questions q
using dup_groups d
where q.id = d.id
  and d.rn > 1;

drop table dup_groups;

end $$;

update quiz_questions set store_id = null where group_key <> 'shop_training';
