-- Jeff, 2026-11-01: the U sheet's 耗損（未入庫） balance carries over to the next month, like COH / UCOH.
-- bk_month_open_balances now also returns `dun` = opening 耗損（未入庫） + Σ (耗損 + +/−) of every
-- day from the opening start month up to (not including) p_month whose 入庫 is NOT ticked.
-- bk_opening_balances.dun = the 耗損（未入庫） at the start of the start month (default 0).

alter table bk_opening_balances add column if not exists dun numeric not null default 0;

drop function if exists bk_month_open_balances(uuid, date);

create function bk_month_open_balances(p_store uuid, p_month date)
returns table(coh numeric, ucoh numeric, dun numeric)
language sql
stable
as $$
  with ob as (
    select start_month, coh, ucoh, dun from bk_opening_balances where store_id = p_store
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
      coalesce(sum(case when c.actual_ca is not null then c.actual_ca - coalesce(sd.o_ca, 0) end), 0) as pm,
      coalesce(sum(case when not coalesce(c.d_stocked, false)
                        then coalesce(c.d_amount, 0)
                             + coalesce(case when c.actual_ca is not null then c.actual_ca - coalesce(sd.o_ca, 0) end, 0)
                   end), 0) as dun_add
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
    coalesce((select ob.ucoh from ob), 0) + cd.dsum + cd.pm - en.ucost - en.ruju,
    coalesce((select ob.dun from ob), 0) + cd.dun_add
  from sf, cd, en;
$$;
