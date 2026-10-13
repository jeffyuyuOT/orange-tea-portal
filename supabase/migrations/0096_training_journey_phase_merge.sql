-- Training Journey phase merge: 7 phases -> 4 (Novice/Practitioner/Advanced/Master),
-- eliminating the separate Expert tier (merged into Master). Jeff's 8-point
-- restructuring request, point 1.
--
-- Run this once, in full, in the Supabase SQL editor for project
-- rwstojuipeaaqdehqoqw. It's written to run top-to-bottom in one transaction
-- -- Supabase's SQL editor wraps each run in a transaction automatically, so
-- if anything fails partway, nothing is left half-applied.
--
-- Checked against live data before writing this: nobody currently sits at
-- training_journey_phase 1-4, nobody holds has_expert_title/has_master_title,
-- and zero historical 'expert'/'master' quiz_attempts exist -- so this has no
-- ambiguous in-flight profile state to worry about.

-- 1. training_journey_phases: merge rows. Delete the rows that get merged away
--    (2 Novice, 4 Proficient, 6 Expert) after folding their hours/question-count
--    into the surviving row of each pair, then renumber the survivors in an
--    order that never collides with a still-occupied phase_number.
delete from training_journey_phases where phase_number in (2, 4, 6);

update training_journey_phases set
  label = 'Novice',
  hours_required = 25,
  level_up_exam_question_count = 2,
  bg_color = '#EFF6FF',
  text_color = '#1E40AF',
  updated_at = now()
where phase_number = 1;

update training_journey_phases set
  phase_number = 2,
  label = 'Practitioner',
  hours_required = 30,
  level_up_exam_question_count = 2,
  bg_color = '#FDF2F8',
  text_color = '#9D174D',
  updated_at = now()
where phase_number = 3;

update training_journey_phases set
  phase_number = 3,
  label = 'Advanced',
  updated_at = now()
where phase_number = 5;

update training_journey_phases set
  phase_number = 4,
  label = 'Master',
  hours_required = null,
  level_up_exam_question_count = null,
  bg_color = '#F1F5F9',
  text_color = '#0F172A',
  updated_at = now()
where phase_number = 7;

alter table training_journey_phases drop constraint training_journey_phases_phase_number_check;
alter table training_journey_phases add constraint training_journey_phases_phase_number_check check (phase_number between 1 and 4);

-- 2. formula_items / shop_training_items: remap training_journey_phase
--    old 1,2 -> 1; old 3,4 -> 2; old 5 -> 3; old 6,7 -> 4.
update formula_items set training_journey_phase = case training_journey_phase
  when 1 then 1 when 2 then 1 when 3 then 2 when 4 then 2 when 5 then 3 when 6 then 4 when 7 then 4
  else training_journey_phase end
where training_journey_phase is not null;

alter table formula_items drop constraint formula_items_training_journey_phase_check;
alter table formula_items add constraint formula_items_training_journey_phase_check check (training_journey_phase between 1 and 4);

update shop_training_items set training_journey_phase = case training_journey_phase
  when 1 then 1 when 2 then 1 when 3 then 2 when 4 then 2 when 5 then 3 when 6 then 4 when 7 then 4
  else training_journey_phase end
where training_journey_phase is not null;

alter table shop_training_items drop constraint shop_training_items_training_journey_phase_check;
alter table shop_training_items add constraint shop_training_items_training_journey_phase_check check (training_journey_phase between 1 and 4);

-- 3. profiles: remap training_journey_phase the same way (0 stays 0),
--    narrow the check, drop has_expert_title/expert_title_earned_at (zero
--    profiles hold has_expert_title=true) and the now-vestigial
--    title_defense_attempts_used (the instant-disqualify rule going in next
--    stops incrementing it), and add the title-loss columns that drive the
--    new one-time login popup (point 5).
update profiles set training_journey_phase = case training_journey_phase
  when 0 then 0 when 1 then 1 when 2 then 1 when 3 then 2 when 4 then 2 when 5 then 3 when 6 then 4 when 7 then 4
  else training_journey_phase end;

alter table profiles drop constraint profiles_training_journey_phase_check;
alter table profiles add constraint profiles_training_journey_phase_check check (training_journey_phase between 0 and 4);

alter table profiles drop column has_expert_title;
alter table profiles drop column expert_title_earned_at;
alter table profiles drop column title_defense_attempts_used;

alter table profiles add column title_loss_from text;
alter table profiles add column title_loss_to text;
alter table profiles add column title_loss_at timestamptz;
alter table profiles add column title_loss_popup_seen_at timestamptz;

-- 4. quiz_attempts: remap historical level_up phase_number values the same
--    way (both existing rows are 5 -> 3), narrow its check, and drop the
--    now-unused 'expert' quiz_type value (zero historical rows use it).
update quiz_attempts set phase_number = case phase_number
  when 1 then 1 when 2 then 1 when 3 then 2 when 4 then 2 when 5 then 3
  else phase_number end
where phase_number is not null;

alter table quiz_attempts drop constraint quiz_attempts_phase_number_check;
alter table quiz_attempts add constraint quiz_attempts_phase_number_check check (phase_number between 1 and 3);

alter table quiz_attempts drop constraint quiz_attempts_quiz_type_check;
alter table quiz_attempts add constraint quiz_attempts_quiz_type_check check (quiz_type = any (array['quick','formal','level_up','master','mock_formal','mock_master']));

-- 5. New singleton title_defense_settings: shared cadence + question-count
--    for BOTH Advanced and Master title defenses (point 4), replacing
--    master_quiz_settings.reminder_period_months (dropped below) and the
--    Advanced-defense cadence that used to read quiz_settings.reminder_period_months.
--    quiz_settings.reminder_period_months is left untouched -- it keeps its
--    separate, unrelated meaning as the generic Bulletin quiz-reminder cadence.
create table title_defense_settings (
  singleton boolean primary key default true check (singleton),
  reminder_period_months integer not null default 3,
  question_count integer not null default 20
);
insert into title_defense_settings (singleton, reminder_period_months, question_count) values (true, 3, 20);
alter table title_defense_settings enable row level security;
create policy "read title_defense_settings" on title_defense_settings for select using (auth.role() = 'authenticated');
create policy "admin write title_defense_settings" on title_defense_settings for all using (is_admin()) with check (is_admin());

alter table master_quiz_settings drop column reminder_period_months;
