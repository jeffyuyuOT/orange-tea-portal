-- BK follow-up (Jeff, 2026-10-12). Run AFTER 0101_bk_bookkeeping.sql.
--
-- 1) 入金 gets a third target, 其他 ('other'), next to Jeff bank / Mao 保險箱.
--
-- 2) BK gets its OWN store list (bk_stores), managed from
--    Sales figure > 資料維護 > 分店管理. Only stores that exist there show up
--    anywhere in the BK page. This is deliberately NOT the portal's `stores`
--    table: nearly everything in the portal (roster, leave, announcements,
--    quiz bank, ...) cascades off stores.id, so "delete a store" in BK must
--    never delete a portal store. Deleting a bk_stores row cascades only to
--    the bk_* tables below (that store's payment types, Sales figure months,
--    U帳 days, 收支 entries and opening balance).
--
--    Existing BK rows were keyed by portal stores.id, so bk_stores is seeded
--    with the SAME ids (every active portal store, plus any store a bk_* row
--    already points at) and the foreign keys are re-pointed — nothing that was
--    already entered is lost or needs touching. Remove the stores you don't
--    want from 分店管理 afterwards.
--
-- Same security model as 0101: RLS = is_developer().

alter table bk_cash_entries drop constraint if exists bk_cash_entries_ruju_target_check;
alter table bk_cash_entries
  add constraint bk_cash_entries_ruju_target_check
  check (ruju_target in ('jeff_bank', 'mao_safe', 'other'));

create table bk_stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bk_stores_name_unique on bk_stores (lower(btrim(name)));

alter table bk_stores enable row level security;
create policy "developer manage bk_stores" on bk_stores for all using (is_developer()) with check (is_developer());

insert into bk_stores (id, name, sort_order)
select s.id, s.name, (row_number() over (order by s.name) - 1)::integer
from stores s
where s.is_active
   or s.id in (
     select store_id from bk_payment_types
     union select store_id from bk_sf_months
     union select store_id from bk_cash_days
     union select store_id from bk_cash_entries
     union select store_id from bk_opening_balances
   );

-- Drop whatever foreign key each bk_* table has to stores(id) (by lookup, so
-- the auto-generated constraint names don't matter), then point it at bk_stores.
do $$
declare
  r record;
begin
  for r in
    select cl.relname as tbl, c.conname
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    where c.contype = 'f'
      and c.confrelid = 'stores'::regclass
      and cl.relname in ('bk_payment_types', 'bk_sf_months', 'bk_cash_days', 'bk_cash_entries', 'bk_opening_balances')
  loop
    execute format('alter table %I drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table bk_payment_types add constraint bk_payment_types_bk_store_fk foreign key (store_id) references bk_stores(id) on delete cascade;
alter table bk_sf_months add constraint bk_sf_months_bk_store_fk foreign key (store_id) references bk_stores(id) on delete cascade;
alter table bk_cash_days add constraint bk_cash_days_bk_store_fk foreign key (store_id) references bk_stores(id) on delete cascade;
alter table bk_cash_entries add constraint bk_cash_entries_bk_store_fk foreign key (store_id) references bk_stores(id) on delete cascade;
alter table bk_opening_balances add constraint bk_opening_balances_bk_store_fk foreign key (store_id) references bk_stores(id) on delete cascade;
