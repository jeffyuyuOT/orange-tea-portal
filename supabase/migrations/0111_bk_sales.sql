-- BK 營業 tab (Jeff, 2026-10-14). Run AFTER 0110_bk_owed_jeff_emma.sql.
--
-- 營業 records each store's daily takings: POS, CV, Self O and the cup counts
-- (P杯數, SO杯數). Totals are computed in the app:
--   總營業額 = POS + Self O + CV × 4
--   總杯數   = P杯數 + SO杯數
--
-- 1) bk_sales_stores: 營業's OWN store list, managed from 系統設置 > 營業 >
--    分店管理 (add / rename / delete / reorder). It is separate from bk_stores
--    (the SF / U帳 list) so the two can differ; `sf_store_id` optionally links a
--    營業 store to a bk_stores row. A linked store reads its POS from that SF
--    store's O.POST (never copied), and that SF store's "Self order kiosk"
--    column reads from 營業's Self O. An unlinked store types POS by hand.
--
-- 2) bk_sales_days: one row per store per day (the manual figures). For a
--    linked store `pos` stays empty — the app reads SF's O.POST instead.
--
-- 3) Seed: one 營業 store per existing bk_stores row (same name, same order,
--    linked), and a ONE-TIME copy of every existing SF "Self order kiosk"
--    amount into bk_sales_days.self_o, so SF's existing kiosk figures and
--    營業's Self O start out identical (no mismatch warnings). Rename / unlink / delete the seeded
--    stores from 系統設置 > 營業 afterwards.
--
-- Same security model as 0101: RLS = is_developer().

create table bk_sales_stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  sort_order integer not null default 0,
  sf_store_id uuid references bk_stores(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bk_sales_stores_name_unique on bk_sales_stores (lower(btrim(name)));
create unique index bk_sales_stores_sf_unique on bk_sales_stores (sf_store_id) where sf_store_id is not null;

alter table bk_sales_stores enable row level security;
create policy "developer manage bk_sales_stores" on bk_sales_stores for all using (is_developer()) with check (is_developer());

create table bk_sales_days (
  store_id uuid not null references bk_sales_stores(id) on delete cascade,
  day date not null,
  pos numeric(12, 2),
  self_o numeric(12, 2),
  cv numeric(12, 2),
  p_cups numeric(12, 2),
  so_cups numeric(12, 2),
  updated_at timestamptz not null default now(),
  primary key (store_id, day)
);

alter table bk_sales_days enable row level security;
create policy "developer manage bk_sales_days" on bk_sales_days for all using (is_developer()) with check (is_developer());

insert into bk_sales_stores (name, sort_order, sf_store_id)
select s.name, s.sort_order, s.id from bk_stores s;

-- One-time copy of SF's Self order kiosk amounts (blank days only; the table is
-- new, so that is every day SF has a kiosk figure for).
insert into bk_sales_days (store_id, day, self_o)
select ss.id, d.day, (d.amounts ->> t.id::text)::numeric
from bk_sales_stores ss
join bk_payment_types t on t.store_id = ss.sf_store_id and t.name = 'Self order kiosk'
join bk_sf_months m on m.store_id = ss.sf_store_id
join bk_sf_days d on d.sf_month_id = m.id
where d.amounts ? t.id::text
  and jsonb_typeof(d.amounts -> t.id::text) = 'number'
on conflict (store_id, day) do nothing;
