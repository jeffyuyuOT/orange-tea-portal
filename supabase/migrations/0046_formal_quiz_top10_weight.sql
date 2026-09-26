-- Formal Quiz's auto-generated "fill in the ingredient quantity" questions
-- (see 0033) are drawn evenly across every memorized item's recipe lines —
-- Top 10 drinks are just as likely to come up as any other item, even
-- though Jeff wants Top 10 drinks to show up more often in this pool.
-- This weight is a multiplier: a fill-in-the-blank candidate linked to a
-- Top 10 drink is this many times more likely to be picked than one that
-- isn't (1 = no boost, matches the old unweighted behaviour).
alter table formal_quiz_settings add column if not exists top10_fill_blank_weight numeric not null default 3;
