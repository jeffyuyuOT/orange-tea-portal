-- Reverts migration 0050. Jeff decided against a tunable "% shown as
-- multiple choice" setting for Formal Quiz's auto-generated formula
-- questions — instead the behavior is now a fixed rule (see
-- FormalQuizModal.jsx): a ⭐ Top 10 drink's question stays typed, every
-- other drink's is shown as multiple choice with deliberately hard
-- distractors. Nothing reads or writes this column anymore, so it comes
-- back out rather than sitting unused like the abandoned
-- FormalQuizSettingsTab.jsx file (which can't be deleted the same way a
-- database column can, from here).
alter table formal_quiz_settings
  drop column if exists mc_fill_blank_pct;
