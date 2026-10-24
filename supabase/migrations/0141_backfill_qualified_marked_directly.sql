-- Jeff, 2026-10-24: "直接qualified的員工入職日期沒有⚠️圖示" — same gap as
-- 0140's hire_date backfill: qualified_marked_directly (0139) defaults to
-- false for every existing row and is only ever SET true going forward, by
-- markQualified()'s direct grant (StaffStudyDetail.jsx). Everyone who was
-- already Qualified before 0139 existed — whichever path they actually took
-- — has qualified_marked_directly = false regardless, so the warning icon
-- never shows for any of them until backfilled once.
--
-- There's no direct historical record of "which button was clicked", but
-- there doesn't need to be: togglePass()'s ordinary Formal Quiz Pass grant
-- always leaves a quiz_attempts row behind (quiz_type = 'formal',
-- passed = true) — that's literally what ticking Pass on a Formal Quiz
-- attempt does. markQualified()'s direct grant never creates one. So any
-- currently-Qualified profile with NO passed Formal Quiz attempt on record
-- can only have gotten there directly. Confirmed via a direct query: 23 of
-- 29 currently-Qualified profiles have no such row.
update profiles p
set qualified_marked_directly = true
where p.qualified = true
  and p.qualified_marked_directly = false
  and not exists (
    select 1 from quiz_attempts qa
    where qa.profile_id = p.id and qa.quiz_type = 'formal' and qa.passed = true
  );
