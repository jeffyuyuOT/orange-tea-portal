-- Jeff, 2026-10-24 (follow-up to 0141): "剛剛那六位是直接mark qualified又自己
-- 去考formal exam所以也需要警示圖示" — 0141's backfill heuristic ("no passed
-- Formal Quiz attempt on record => must have been marked directly") got
-- these 6 backwards. Jeff's own clarification: these 6 WERE directly marked
-- qualified (same "experienced hire" case as everyone else 0141 already
-- flagged) — they just ALSO sat a Formal Quiz themselves afterward. That
-- later attempt's passed=true isn't a manager's review grant (the actual
-- thing qualified_marked_directly is meant to exclude) — StaffStudyDetail.jsx's
-- own togglePass() comment explains why: once someone is ALREADY Qualified,
-- the quiz flow auto-ticks Pass on any later Formal Quiz attempt with no
-- review needed, so a passed row proves nothing about how they originally
-- became qualified.
--
-- Jeff also confirmed the forward-looking rule stays as the code already
-- has it: a genuinely NEW trainee who trains in the app and earns Qualified
-- via a manager's ordinary Formal Quiz Pass review (togglePass, never sets
-- this column) should NOT get the warning icon — only an experienced-hire
-- "Mark as Qualified" grant (markQualified, direct) should. The problem was
-- purely 0141's one-time backfill guess for people who predate this column
-- entirely, not the ongoing logic.
--
-- So: every CURRENTLY qualified profile is, at this early point in the
-- app's rollout, a pre-existing/senior hire by definition (Jeff: "現在是
-- 剛開始使用app，很多資深員工也是最近才打卡") — simply flag everyone 0141
-- missed, no formal-quiz-pass exemption this time.
update profiles
set qualified_marked_directly = true
where qualified = true
  and qualified_marked_directly = false;
