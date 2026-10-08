-- Jeff, 2026-10-08: three related Training Journey changes.
--
-- 1) Each Phase 1-3 Level-Up Exam gets its own error-tolerance setting,
--    alongside its existing question count — "每個phase level up exam題數
--    設置後面也新增容錯率題數設置". Previously every Level-Up Exam required
--    a flat 100% (every question correct) — see LevelUpExamModal.jsx.
alter table public.training_journey_phases
  add column if not exists level_up_error_tolerance integer not null default 0;

-- 2) Title Defense Quiz (Advanced via Formal Exam, Master via Master Exam)
--    gets back a grace period — Jeff: "title defense quiz失敗的話，應該還有
--    2次機會，所以总共可以考3次" — 2 extra chances after a first failure, 3
--    total attempts, before disqualifying. Re-adds
--    profiles.title_defense_attempts_used, dropped in migration 0096 when
--    the old 3-strike grace was removed (point 4) — same column, same idea,
--    brought back the same day at Jeff's request. Resets to 0 on any pass
--    (voluntary or defense) or whenever a fresh defense clock starts — see
--    trainingJourney.js.
alter table public.profiles
  add column if not exists title_defense_attempts_used integer not null default 0;

-- 3) A hard 7-day deadline from the moment a defense becomes due — Jeff:
--    "收到通知有七天時間讓你考，沒考或沒考過的話就會降級" — enforced by a
--    daily pg_cron job (same pattern as migrations 0084/0088) rather than
--    only checked when the person happens to log in, since someone who
--    simply never opens the app for a week still needs to be demoted.
--    Independent of the attempts-remaining grace above: running out the
--    clock disqualifies even with attempts still unused.
create extension if not exists pg_cron;

create or replace function expire_overdue_title_defenses()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  months int;
  due_at timestamptz;
  rec record;
begin
  select reminder_period_months into months from title_defense_settings limit 1;
  months := coalesce(months, 3);

  for rec in
    select id, has_master_title
    from profiles
    where title_defense_due_at is not null
      and title_defense_due_at <= now() - interval '7 days'
      and qualified = true
  loop
    if rec.has_master_title then
      -- Mirrors recordMasterExamResult's failed-defense branch: lose
      -- Master, land back on Advanced with a fresh full defense cycle.
      due_at := now() + (months::text || ' months')::interval;
      update profiles set
        has_master_title = false,
        title_defense_due_at = due_at,
        title_defense_attempts_used = 0,
        title_loss_from = 'Master',
        title_loss_to = 'Advanced',
        title_loss_at = now()
      where id = rec.id;
    else
      -- Mirrors recordFormalDefenseResult's failed-defense branch: lose
      -- Advanced entirely, back to Practitioner, no due date until regained
      -- (recovery via Phase 3's Level-Up Exam starts a fresh clock).
      update profiles set
        qualified = false,
        qualified_at = now(),
        training_journey_phase = 2,
        has_master_title = false,
        title_defense_due_at = null,
        title_defense_attempts_used = 0,
        title_loss_from = 'Advanced',
        title_loss_to = 'Practitioner',
        title_loss_at = now()
      where id = rec.id;
    end if;
  end loop;
end;
$$;

-- 15:00 UTC = 01:00 Brisbane (AEST, fixed UTC+10, no daylight saving) —
-- quiet hours, same style/time-of-day reasoning as the existing daily jobs.
select cron.schedule(
  'expire-overdue-title-defenses',
  '0 15 * * *',
  $$select expire_overdue_title_defenses();$$
);
