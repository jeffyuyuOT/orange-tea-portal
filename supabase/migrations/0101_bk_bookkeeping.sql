-- BK (記帳) page, developer-only — Sales figure + U帳 (spec:
-- claude/bk-page-spec.md in the OT Portal Project). 分紅 / 積欠 / 系統設置 are
-- not specced yet and have no tables here.
--
-- Same security model as payroll_* (0057): every table is RLS-restricted to
-- is_developer(), so the nav/permission key (developer_tools.bk) is only
-- cosmetic — a non-developer account gets nothing back even if it reaches
-- these tables directly.
--
-- Data model, in one paragraph:
--   * bk_payment_types      — Sales-figure columns, PER STORE (Jeff: 各分店獨立).
--                             kind 'main' | 'sub'; a sub belongs to one main.
--   * bk_sf_months          — one row per store+month, status draft/submitted.
--   * bk_sf_days            — one row per day: O.CA, Total (the figure printed on
--                             the sales report, checked against the sum of the
--                             main columns) and a jsonb of typed-in amounts.
--                             Cash is NOT stored — it is always O.CA − D.
--   * bk_cash_days          — U帳 manual per-day inputs: 實 CA, D (未入庫), 入庫 tick.
--   * bk_cash_entries       — U帳 收支: Icost / Ucost / deposit / withdraw / 入金.
--   * bk_opening_balances   — starting COH / UCOH per store. COH/UCOH for any
--                             month are rolled forward live from this (Jeff:
--                             由前一個月資料即時逐月累計), never stored per month,
--                             so editing an old month corrects every later one.

create table bk_payment_types (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('main', 'sub')),
  parent_id uuid references bk_payment_types(id) on delete cascade,
  -- Cash and Total Eftpos: name/active flag can't be edited (order still can).
  is_locked boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bk_payment_types_sub_has_parent check ((kind = 'sub') = (parent_id is not null)),
  constraint bk_payment_types_store_name_unique unique (store_id, name)
);
create index bk_payment_types_store_idx on bk_payment_types (store_id, kind, sort_order);

create table bk_sf_months (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bk_sf_months_unique unique (store_id, year, month)
);

create table bk_sf_days (
  sf_month_id uuid not null references bk_sf_months(id) on delete cascade,
  day date not null,
  o_ca numeric(12, 2),
  total numeric(12, 2),
  -- { "<bk_payment_types.id>": number } — only typed-in leaf columns (a main
  -- without subs, or a sub). Cash and "main made of subs" are computed.
  amounts jsonb not null default '{}'::jsonb,
  primary key (sf_month_id, day)
);

create table bk_cash_days (
  store_id uuid not null references stores(id) on delete cascade,
  day date not null,
  actual_ca numeric(12, 2),
  d_amount numeric(12, 2),
  d_stocked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (store_id, day)
);

create table bk_cash_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  entry_date date not null,
  kind text not null check (kind in ('icost', 'ucost', 'deposit', 'withdraw', 'ruju')),
  description text,
  -- icost/ucost may be negative (= income). deposit/withdraw/ruju are entered
  -- positive; the kind carries the direction.
  amount numeric(12, 2) not null,
  note text,
  -- only for 入金 (ruju)
  ruju_target text check (ruju_target in ('jeff_bank', 'mao_safe')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bk_cash_entries_ruju_target check ((kind = 'ruju') = (ruju_target is not null)),
  constraint bk_cash_entries_dw_ruju_positive check (kind in ('icost', 'ucost') or amount > 0)
);
create index bk_cash_entries_store_date_idx on bk_cash_entries (store_id, entry_date);

create table bk_opening_balances (
  store_id uuid primary key references stores(id) on delete cascade,
  -- first day of the month the opening figures apply to (balance BEFORE it)
  start_month date not null check (extract(day from start_month) = 1),
  coh numeric(12, 2) not null default 0,
  ucoh numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now()
);

alter table bk_payment_types enable row level security;
alter table bk_sf_months enable row level security;
alter table bk_sf_days enable row level security;
alter table bk_cash_days enable row level security;
alter table bk_cash_entries enable row level security;
alter table bk_opening_balances enable row level security;

create policy "developer manage bk_payment_types" on bk_payment_types for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_sf_months" on bk_sf_months for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_sf_days" on bk_sf_days for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_cash_days" on bk_cash_days for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_cash_entries" on bk_cash_entries for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_opening_balances" on bk_opening_balances for all using (is_developer()) with check (is_developer());

-- Default Sales-figure columns for a store: main Cash, Total Eftpos (both
-- locked), Uber Eat, Doordash, Fantuan, Payo, Panda; sub POS eftpos and Self
-- order kiosk under Total Eftpos. No-op if the store already has any column,
-- so it is safe to call again (the BK page calls it for a store with none).
-- SECURITY INVOKER on purpose: called from the client it still goes through
-- the is_developer() policies above.
create or replace function bk_seed_payment_types(p_store uuid)
returns void language plpgsql as $$
declare
  v_total uuid;
begin
  if exists (select 1 from bk_payment_types where store_id = p_store) then
    return;
  end if;
  insert into bk_payment_types (store_id, name, kind, is_locked, sort_order)
    values (p_store, 'Cash', 'main', true, 0);
  insert into bk_payment_types (store_id, name, kind, is_locked, sort_order)
    values (p_store, 'Total Eftpos', 'main', true, 1)
    returning id into v_total;
  insert into bk_payment_types (store_id, name, kind, sort_order) values
    (p_store, 'Uber Eat', 'main', 2),
    (p_store, 'Doordash', 'main', 3),
    (p_store, 'Fantuan', 'main', 4),
    (p_store, 'Payo', 'main', 5),
    (p_store, 'Panda', 'main', 6);
  insert into bk_payment_types (store_id, name, kind, parent_id, sort_order) values
    (p_store, 'POS eftpos', 'sub', v_total, 0),
    (p_store, 'Self order kiosk', 'sub', v_total, 1);
end;
$$;

select bk_seed_payment_types(id) from stores;

-- COH / UCOH at the START of p_month (= closing balance of the month before),
-- rolled forward from bk_opening_balances.start_month. With no opening row the
-- roll starts from zero at the beginning of time.
--   COH  = opening + Σ SF cash − deposit + withdraw − Icost      (SF cash = O.CA − D)
--   UCOH = opening + Σ D + Σ(+/−) − Ucost − 入金                 (+/− = 實CA − O.CA)
-- Σ SF cash is computed as Σ O.CA − Σ D (identical, day by day).
create or replace function bk_month_open_balances(p_store uuid, p_month date)
returns table (coh numeric, ucoh numeric)
language sql stable as $$
  with ob as (
    select start_month, coh, ucoh from bk_opening_balances where store_id = p_store
  ),
  s as (
    select coalesce((select start_month from ob), date '1900-01-01') as d
  ),
  sf as (
    select coalesce(sum(d.o_ca), 0) as oca
    from bk_sf_days d
    join bk_sf_months m on m.id = d.sf_month_id
    where m.store_id = p_store
      and d.day >= (select d from s) and d.day < p_month
  ),
  cd as (
    select
      coalesce(sum(c.d_amount), 0) as dsum,
      coalesce(sum(case when c.actual_ca is not null then c.actual_ca - coalesce(sd.o_ca, 0) end), 0) as pm
    from bk_cash_days c
    left join (
      select d.day, d.o_ca
      from bk_sf_days d
      join bk_sf_months m on m.id = d.sf_month_id
      where m.store_id = p_store
    ) sd on sd.day = c.day
    where c.store_id = p_store
      and c.day >= (select d from s) and c.day < p_month
  ),
  en as (
    select
      coalesce(sum(amount) filter (where kind = 'deposit'), 0) as dep,
      coalesce(sum(amount) filter (where kind = 'withdraw'), 0) as wd,
      coalesce(sum(amount) filter (where kind = 'icost'), 0) as icost,
      coalesce(sum(amount) filter (where kind = 'ucost'), 0) as ucost,
      coalesce(sum(amount) filter (where kind = 'ruju'), 0) as ruju
    from bk_cash_entries
    where store_id = p_store
      and entry_date >= (select d from s) and entry_date < p_month
  )
  select
    coalesce((select ob.coh from ob), 0) + sf.oca - cd.dsum - en.dep + en.wd - en.icost,
    coalesce((select ob.ucoh from ob), 0) + cd.dsum + cd.pm - en.ucost - en.ruju
  from sf, cd, en;
$$;
