-- Jeff, 2026-10-07: "title defense exam增加Error tolerance (non-must-know
-- misses allowed)選項" — Title Defense Quiz (Advanced + Master) gets its own
-- error-tolerance setting, same shape/meaning as master_quiz_settings.
-- error_tolerance (a missed must-know-linked question always fails
-- regardless; this only covers how many non-must-know misses are still
-- tolerated as a pass). Previously a Master title-defense attempt borrowed
-- master_quiz_settings.error_tolerance (the voluntary Master Exam's own
-- tolerance) and a Formal title-defense attempt had no tolerance concept at
-- all (any miss failed it outright) — both now read this shared column
-- instead, independent of the voluntary Formal/Master Exam settings.
alter table public.title_defense_settings
  add column if not exists error_tolerance integer not null default 0;
