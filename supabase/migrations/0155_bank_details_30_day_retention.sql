-- Jeff, 2026-10-29: bank details (profiles.bank_account_name / bsb / account_number) are kept for
-- 30 days after they were last saved, then cleared by a daily pg_cron job. My Information and
-- Staff Information show "Please back up ... deleted on <date>" from bank_saved_at + 30 days.

alter table public.profiles add column if not exists bank_saved_at timestamptz;

-- Existing bank details start their 30 days now.
update public.profiles
set bank_saved_at = now()
where bank_saved_at is null
  and (nullif(trim(coalesce(bank_account_name, '')), '') is not null
    or nullif(trim(coalesce(bsb, '')), '') is not null
    or nullif(trim(coalesce(account_number, '')), '') is not null);

create or replace function public.profiles_set_bank_saved_at()
returns trigger
language plpgsql
as $$
begin
  if nullif(trim(coalesce(new.bank_account_name, '')), '') is null
     and nullif(trim(coalesce(new.bsb, '')), '') is null
     and nullif(trim(coalesce(new.account_number, '')), '') is null then
    new.bank_saved_at := null;
  elsif tg_op = 'INSERT'
     or new.bank_account_name is distinct from old.bank_account_name
     or new.bsb is distinct from old.bsb
     or new.account_number is distinct from old.account_number then
    new.bank_saved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_bank_saved_at on public.profiles;
create trigger trg_profiles_bank_saved_at
before insert or update of bank_account_name, bsb, account_number on public.profiles
for each row execute function public.profiles_set_bank_saved_at();

create or replace function public.cleanup_expired_bank_details()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
  set bank_account_name = null, bsb = null, account_number = null, bank_saved_at = null
  where bank_saved_at < now() - interval '30 days';
end;
$$;

revoke all on function public.cleanup_expired_bank_details() from public, anon, authenticated;

-- 03:40 UTC daily (= 13:40 Brisbane).
select cron.schedule('bank-details-30-day-cleanup', '40 3 * * *', 'select public.cleanup_expired_bank_details();');
