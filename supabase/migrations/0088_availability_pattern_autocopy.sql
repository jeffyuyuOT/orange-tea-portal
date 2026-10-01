-- Jeff, 2026-10-02: the auto-copy half of "lock time pattern" (see
-- migration 0087 for the flag itself). Runs weekly, early in the week —
-- well before Thursday's availability reminder (migration 0084) checks
-- whether next week has been filled in — copying every locked profile's
-- just-started week's availability_days/availability_windows forward into
-- the new next week. Once this has run, 0084's own "not exists a next-week
-- row" condition already excludes these profiles from the reminder with no
-- extra change needed there: to that check, a locked profile with a
-- freshly auto-copied next week looks exactly like someone who filled next
-- week in themselves.
--
-- Like migration 0084, this needs `create extension pg_cron` and a
-- persistent cron.schedule(...) job — the same kind of change the Supabase
-- MCP tool's "Production Deploy" classifier blocked Claude from applying
-- automatically last time. NOT applied here; Jeff needs to run this
-- himself via the Supabase SQL Editor (or explicitly ask Claude to apply
-- it, which will prompt the same confirmation again).
create extension if not exists pg_cron;

create or replace function copy_locked_availability_patterns()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Queensland has no daylight saving, so Brisbane-local "this week"/"next
  -- week" computed this way is stable year-round — same approach 0084
  -- already uses for next_week.
  this_week date := (date_trunc('week', (now() at time zone 'Australia/Brisbane'))::date);
  next_week date := this_week + 7;
  rec record;
  src_day record;
  new_day_id uuid;
  i int;
begin
  for rec in
    select id as profile_id from profiles where availability_pattern_locked and is_active
  loop
    for i in 0..6 loop
      -- Never overwrites a next-week row that already exists for this day
      -- — whether the person (or a manager) set it by hand for some
      -- reason despite being locked, or a previous run of this same job
      -- already copied it in.
      if exists (select 1 from availability_days where profile_id = rec.profile_id and entry_date = next_week + i) then
        continue;
      end if;

      select * into src_day from availability_days where profile_id = rec.profile_id and entry_date = this_week + i;
      if not found then
        -- No row for that day this week = "all day available" (the
        -- default, migration 0063) — nothing to copy; next week already
        -- defaults the same way with no row needed at all.
        continue;
      end if;

      insert into availability_days (profile_id, week_start_date, entry_date, mode, boundary_time)
      values (rec.profile_id, next_week, next_week + i, src_day.mode, src_day.boundary_time)
      returning id into new_day_id;

      insert into availability_windows (availability_day_id, start_time, end_time)
      select new_day_id, aw.start_time, aw.end_time
      from availability_windows aw
      where aw.availability_day_id = src_day.id;
    end loop;
  end loop;
end;
$$;

-- Sunday 14:10 UTC = Monday 00:10 Brisbane (AEST, fixed UTC+10) — just
-- after each week rolls over, so "this week" in the function above is
-- already the week that just started, and the copy into "next week" lands
-- days before Thursday's reminder job would otherwise fire for it.
select cron.schedule(
  'copy-locked-availability-patterns',
  '10 14 * * 0',
  $$select copy_locked_availability_patterns();$$
);
