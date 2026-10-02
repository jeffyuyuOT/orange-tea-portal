-- Training Journey: a 6-phase gamified training/certification system built
-- on top of the existing must-know item (formula_items.is_must_know/top_10,
-- shop_training_items.is_must_know) and Qualified (profiles.qualified)
-- infrastructure. See claude/user-roster-handoff.md for the full feature
-- spec (Jeff, 2026-10-02). This migration lays the whole schema down in one
-- pass; the UI/engine lands in phases (Take a Quiz merge, Training Journey
-- view, Admin/Shop settings pages, exam engine, roster/dashboard display).

-- Phase 1-5 assignment for a must-know item — a plain nullable column, same
-- shape as is_must_know/top_10, rather than a join table: "not yet assigned
-- to any phase" is just NULL ("pending", per Jeff's Admin Training Journey
-- Setting spec). Admin assigns formula_items (global); each store assigns
-- its own shop_training_items. Phase 6 is never assigned here — it's "every
-- item, must-know or not" by definition, not a phase membership.
alter table formula_items add column if not exists training_journey_phase smallint
  check (training_journey_phase between 1 and 5);
alter table shop_training_items add column if not exists training_journey_phase smallint
  check (training_journey_phase between 1 and 5);

-- The 6 phases themselves. Labels are fixed (not admin-editable — only the
-- styling/hours/question-count below are, per Jeff's "Admin Training Journey
-- Setting" > "Phase Setting" spec). Same RLS shape as app_sidebar_order
-- (migration 0055): every signed-in person reads this to render their own
-- Training Journey tab; only admin/developer writes it.
create table training_journey_phases (
  phase_number smallint primary key check (phase_number between 1 and 6),
  label text not null,
  hours_required integer, -- cumulative hours to fill this phase's bar; null for phase 6 (not hour-gated — see phase_six progress below)
  bg_color text not null,
  text_color text not null,
  level_up_exam_question_count integer, -- phases 1-5 only; phase 5/6's real exam settings live in formal_quiz_settings/master_quiz_settings
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

-- Seeded with Jeff's exact colors. hours_required/level_up_exam_question_count
-- are starting defaults (20h per phase = the existing 100h "should be fully
-- memorized by" standard already used elsewhere in the app, split evenly
-- across phases 1-5) — all admin-editable from day one via Phase Setting.
insert into training_journey_phases (phase_number, label, hours_required, bg_color, text_color, level_up_exam_question_count) values
  (1, 'Beginner',     20, '#F0FDF4', '#166534', 10),
  (2, 'Novice',       20, '#EFF6FF', '#1E40AF', 10),
  (3, 'Practitioner', 20, '#FDF2F8', '#9D174D', 10),
  (4, 'Proficient',   20, '#FFFBEB', '#A16207', 10),
  (5, 'Advanced',     20, '#F5F3FF', '#6D28D9', 10),
  (6, 'Master',     null, '#F1F5F9', '#0F172A', null);

alter table training_journey_phases enable row level security;
create policy "read training_journey_phases" on training_journey_phases for select using (auth.role() = 'authenticated');
create policy "admin write training_journey_phases" on training_journey_phases for all using (is_admin()) with check (is_admin());

-- quiz_attempts: four new quiz_type values —
--   level_up      — a Phase 1-5 Level-Up Exam attempt (self-graded, all-correct required)
--   master        — a real Master Exam attempt (self-graded, error_tolerance-based)
--   mock_formal   — practice run of Formal Quiz's question logic, from the new Take a Quiz picker
--   mock_master   — practice run of Master Exam's question logic, from the same picker
-- Mock attempts are saved for history like any other (Jeff, 2026-10-02) but
-- never drive qualification/title state — the application layer simply
-- never writes profiles from a mock_* attempt. `phase_number` records which
-- phase a level_up attempt graded (null for every other quiz_type).
alter table quiz_attempts drop constraint if exists quiz_attempts_quiz_type_check;
alter table quiz_attempts add constraint quiz_attempts_quiz_type_check
  check (quiz_type in ('quick', 'formal', 'level_up', 'master', 'mock_formal', 'mock_master'));
alter table quiz_attempts add column if not exists phase_number smallint check (phase_number between 1 and 5);

-- profiles: Training Journey phase/title state. `qualified`/`qualified_at`/
-- `qualified_by` (migration 0049) keep their exact existing meaning — "holds
-- at least the Advanced title" — unchanged; disqualification already flips
-- `qualified` to false via the existing mechanism, and now additionally
-- resets `training_journey_phase` to 4 (Proficient) and `has_master_title`
-- to false, at the application layer (Phase D).
alter table profiles
  add column if not exists training_journey_phase smallint not null default 0 check (training_journey_phase between 0 and 6),
  add column if not exists has_master_title boolean not null default false,
  add column if not exists master_title_earned_at timestamptz,
  add column if not exists title_defense_due_at timestamptz,
  add column if not exists title_defense_attempts_used integer not null default 0;

-- Master Quiz settings — same global singleton shape as formal_quiz_settings
-- (migration 0079), added under Admin Quiz Bank's Setting tab per Jeff's
-- point 10. error_tolerance = how many NON-must-know misses are allowed; any
-- must-know-linked miss always fails the Master Exam regardless.
create table master_quiz_settings (
  singleton boolean primary key default true check (singleton),
  question_count integer not null default 30,
  error_tolerance integer not null default 0,
  reminder_period_months integer not null default 3
);
insert into master_quiz_settings (singleton, question_count, error_tolerance, reminder_period_months) values (true, 30, 0, 3);
alter table master_quiz_settings enable row level security;
create policy "read master_quiz_settings" on master_quiz_settings for select using (auth.role() = 'authenticated');
create policy "admin write master_quiz_settings" on master_quiz_settings for all using (is_admin()) with check (is_admin());

-- System Setting's new "Roster Name Display Format" dropdown — same global
-- singleton shape again. 'original' preserves today's exact behavior
-- (RosterWeekTable.jsx/RosterEntryGrid.jsx's qualified-only red/gray split).
create table app_display_settings (
  singleton boolean primary key default true check (singleton),
  roster_name_display_format text not null default 'original'
    check (roster_name_display_format in ('original', 'title_crown', 'title_no_crown')),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
insert into app_display_settings (singleton, roster_name_display_format) values (true, 'original');
alter table app_display_settings enable row level security;
create policy "read app_display_settings" on app_display_settings for select using (auth.role() = 'authenticated');
create policy "admin write app_display_settings" on app_display_settings for all using (is_admin()) with check (is_admin());
