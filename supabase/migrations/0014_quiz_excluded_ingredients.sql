-- Lets an admin mark specific ingredients as excluded from the
-- auto-generated "how much X goes in Y" formula quiz questions (Quiz Bank
-- > Setting) — e.g. an ingredient whose quantity isn't meaningful to be
-- quizzed on (water, ice) — see chat discussion 2026-09-20. Everything is
-- eligible by default (per the earlier decision that this needs no
-- curation); this table is only the opt-out list.
create table if not exists quiz_excluded_ingredients (
  ingredient_id uuid primary key references ingredient_master(id) on delete cascade,
  created_at    timestamptz not null default now()
);

alter table quiz_excluded_ingredients enable row level security;

create policy "read quiz_excluded_ingredients" on quiz_excluded_ingredients for select using (auth.role() = 'authenticated');
create policy "admin write quiz_excluded_ingredients" on quiz_excluded_ingredients for all using (is_admin()) with check (is_admin());
