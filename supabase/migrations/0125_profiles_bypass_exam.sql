-- User Management › "Bypass exam" (Jeff, 2026-10-20): a person with it ticked
-- never has to take the Title Defend exam (Advanced / Master). Always on for
-- anyone who doesn't join store activity; optional for those who do.

alter table public.profiles
  add column if not exists bypass_exam boolean not null default false;

-- everyone already not joining store activity gets it
update public.profiles set bypass_exam = true where join_store_activity = false and bypass_exam = false;

-- keep the rule in the database too, whichever screen changes join_store_activity
create or replace function public.profiles_bypass_exam_rule()
returns trigger
language plpgsql
as $$
begin
  if new.join_store_activity = false then
    new.bypass_exam := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_bypass_exam_rule on public.profiles;
create trigger trg_profiles_bypass_exam_rule
  before insert or update of join_store_activity, bypass_exam on public.profiles
  for each row execute function public.profiles_bypass_exam_rule();

-- the daily job that demotes overdue title defenses skips bypassed people
create or replace function public.expire_overdue_title_defenses()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      and bypass_exam = false
  loop
    if rec.has_master_title then
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
$function$;
