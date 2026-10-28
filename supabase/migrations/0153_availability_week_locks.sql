-- Jeff, 2026-10-28: "my available time的在這禮拜跟下禮拜的lock time pattern
-- 可以各自勾取(不用同時勾取跟取消)，同時勾取lock time pattern時並save時兩邊
-- 才會同步，某一個禮拜出現在下禮拜時，如果其上禮拜是有勾選lock time
-- pattern，則直接copy上禮拜時間並保留lock time pattern勾取" — replaces
-- migration 0087's single profile-level `availability_pattern_locked`
-- column (which forced This Week and Next Week to always show/toggle the
-- same value — both sections literally read/wrote that one shared flag)
-- with a per-week lock: one existence row per (profile, week_start_date).
-- Locked = a row exists; unlocked = no row — the same "absence is the
-- default" shape availability_days itself already uses. Existence-only
-- (no boolean column to flip) is what lets the weekly auto-copy job below
-- propagate a lock forward with a plain `insert ... on conflict do
-- nothing`, with no risk of it ever re-locking a week whose row was
-- deliberately deleted (unlocked) earlier — each week_start_date is only
-- ever the INSERT target of that forward-propagation step the one time it
-- transitions from not-yet-existing into becoming the new "next week".
create table availability_week_locks (
  profile_id uuid not null references profiles(id) on delete cascade,
  week_start_date date not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, week_start_date)
);

create index idx_availability_week_locks_profile on availability_week_locks(profile_id);

alter table availability_week_locks enable row level security;

-- Same read/write split as availability_days itself (migration 0063):
-- self, or a manager/admin who can see this person at one of the
-- manager's own current stores, can READ; only the person themselves can
-- WRITE (lock/unlock their own pattern). No update policy needed — a row
-- either exists (locked) or doesn't (unlocked), so toggling is always an
-- insert or a delete, never an update.
create policy "read own or managed availability_week_locks" on availability_week_locks
  for select using (
    profile_id = auth.uid()
    or is_admin()
    or (is_manager_or_admin() and exists (
      select 1 from user_stores us where us.profile_id = availability_week_locks.profile_id and us.store_id = any (current_store_ids())
    ))
  );

create policy "write own availability_week_locks" on availability_week_locks
  for insert with check (profile_id = auth.uid());

create policy "delete own availability_week_locks" on availability_week_locks
  for delete using (profile_id = auth.uid());

-- Backfill: anyone currently locked under the old shared flag was, by that
-- old design, shown as locked for BOTH This Week and Next Week at once (one
-- flag, read by both sections) — so give them lock rows for both of
-- today's this/next week on cutover, matching what they were already
-- seeing on screen before this migration, rather than silently dropping
-- their lock the moment this ships.
insert into availability_week_locks (profile_id, week_start_date)
select id, (date_trunc('week', (now() at time zone 'Australia/Brisbane'))::date)
from profiles where availability_pattern_locked
union
select id, (date_trunc('week', (now() at time zone 'Australia/Brisbane'))::date) + 7
from profiles where availability_pattern_locked
on conflict do nothing;

alter table profiles drop column if exists availability_pattern_locked;

-- Rewritten weekly auto-copy job (migration 0088's original). Still runs
-- Sunday 14:10 UTC = Monday 00:10 Brisbane (just after each week rolls
-- over), and still never overwrites a next-week day row that already
-- exists. The one behavioural change: it now reads EACH profile's own
-- `this_week` lock row (instead of one shared profile-wide flag) and,
-- when that week is locked, also PROPAGATES the lock forward onto
-- `next_week` (insert ... on conflict do nothing) before copying the day
-- data — this is the "chain" Jeff described: a lock that's on when its
-- week becomes "This Week" keeps itself on one week further, every week,
-- for as long as each new "This Week" is still locked when its own turn
-- comes. A week whose lock was explicitly turned off is simply never the
-- source of this propagation, so unlocking This Week stops the chain
-- without needing to touch Next Week's already-separate lock at all.
create or replace function copy_locked_availability_patterns()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  this_week date := (date_trunc('week', (now() at time zone 'Australia/Brisbane'))::date);
  next_week date := this_week + 7;
  rec record;
  src_day record;
  new_day_id uuid;
  i int;
begin
  for rec in
    select p.id as profile_id
    from profiles p
    where p.is_active
      and exists (
        select 1 from availability_week_locks l
        where l.profile_id = p.id and l.week_start_date = this_week
      )
  loop
    -- Chain the lock forward onto next week — a no-op if next week
    -- already has its own lock row (independently set, or carried over
    -- from an earlier run of this same job).
    insert into availability_week_locks (profile_id, week_start_date)
    values (rec.profile_id, next_week)
    on conflict (profile_id, week_start_date) do nothing;

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
