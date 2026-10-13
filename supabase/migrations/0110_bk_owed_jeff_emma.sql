-- BK 積欠 > Jeff / Emma (Jeff, 2026-10-13). Run AFTER 0109_bk_store_transfer.sql.
--
-- 積欠 now has three sub-tabs: Jeff, Emma, 分店之間 (分店之間 already exists as
-- bk_store_debts from migration 0109 — unchanged here).
--
-- Jeff: 薪水 (salary) / 預付 (advance paid to him) / 預拿 (advance he has drawn).
-- bk_owed_jeff_entries holds only MANUALLY typed rows — all three kinds can be
-- added here directly. 薪水 is ALSO populated live from the payroll app's own
-- completed calc sheets (bk_jeff_payroll_salary(), read-only, never written
-- back) and merged with any manual 薪水 rows at display time, so there is
-- nothing to keep in sync: payroll stays the one source of truth for
-- payroll-computed pay, this table only adds what Jeff types by hand.
--
-- Emma: her Sunnybank-入金-based bonus. No new table for the 總覽 list itself —
-- it reads straight from bk_cash_entries (kind 'ruju', store = Sunnybank,
-- amount > 0, same as the Sales-figure/U帳 pages read their own source
-- tables live). bk_owed_emma_claims is the submitted-settlement snapshot: once
-- she claims a batch of 入金 rows, the rows + notes + the 10% bonus total are
-- frozen into one record (same snapshot pattern as bk_settlements, migration
-- 0108) so editing an old 入金 row later never rewrites history. A 入金 row's
-- id appearing inside any bk_owed_emma_claims.rows means it has already been
-- claimed — checked client-side against this table, no separate flag column.

create table bk_owed_jeff_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('salary', 'advance_pay', 'advance_draw')), -- 薪水 / 預付 / 預拿
  entry_date date not null,
  description text,
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bk_owed_jeff_entries_kind_date_idx on bk_owed_jeff_entries (kind, entry_date);

alter table bk_owed_jeff_entries enable row level security;
create policy "developer manage bk_owed_jeff_entries" on bk_owed_jeff_entries for all using (is_developer()) with check (is_developer());

-- Jeff's own pay per completed payroll calc sheet (public/payroll, the
-- standalone KV-store app — payroll_employees / payroll_calc_sheets). Matches
-- by name + paymentType='Direct' the same way the payroll app itself matches
-- a Direct employee across stores, rather than hardcoding an employee id.
-- Read-only, SECURITY INVOKER (same is_developer() policies the payroll app
-- already relies on) — never writes to payroll_* tables.
create or replace function bk_jeff_payroll_salary()
returns table (sheet_id text, date_from date, date_to date, amount numeric)
language sql stable security invoker as $$
  select
    cs.row_key,
    (cs.data->>'dateFrom')::date,
    (cs.data->>'dateTo')::date,
    sum(coalesce((row_elem->>'total')::numeric, 0))
  from payroll_calc_sheets cs
  cross join lateral jsonb_each(cs.data->'stores') as store_kv(key, value)
  cross join lateral jsonb_array_elements(store_kv.value->'rows') as row_elem
  where cs.data->>'status' = 'completed'
    and row_elem->>'paymentType' = 'Direct'
    and row_elem->>'employeeId' in (
      select row_key from payroll_employees
      where btrim(data->>'name') ilike 'jeff' and data->>'paymentType' = 'Direct'
    )
  group by cs.row_key, cs.data->>'dateFrom', cs.data->>'dateTo'
  having sum(coalesce((row_elem->>'total')::numeric, 0)) <> 0
  order by (cs.data->>'dateFrom')::date;
$$;

create table bk_owed_emma_claims (
  id uuid primary key default gen_random_uuid(),
  submitted_at date not null,
  total_amount numeric(12, 2) not null check (total_amount > 0),
  -- [{ entry_id, entry_date, amount, note }], one per claimed 入金 row.
  rows jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bk_owed_emma_claims_date_idx on bk_owed_emma_claims (submitted_at);

alter table bk_owed_emma_claims enable row level security;
create policy "developer manage bk_owed_emma_claims" on bk_owed_emma_claims for all using (is_developer()) with check (is_developer());
