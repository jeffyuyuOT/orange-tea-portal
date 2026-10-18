-- BK 小時統計 now follows the 營業 stores (bk_sales_stores) instead of the SF / U帳 stores (bk_stores).
-- Existing rows are re-keyed through bk_sales_stores.sf_store_id; the old tables are kept as
-- *_bak_20261018 until you have checked the 小時統計 page (drop them afterwards).
begin;

create table bk_hour_sales_bak_20261018 as table bk_hour_sales;
create table bk_hour_settings_bak_20261018 as table bk_hour_settings;

-- every existing hour row must belong to a store that is linked from 營業, else stop
do $$
begin
  if exists (
    select 1 from bk_hour_sales h
    where not exists (select 1 from bk_sales_stores s where s.sf_store_id = h.store_id)
  ) or exists (
    select 1 from bk_hour_settings h
    where not exists (select 1 from bk_sales_stores s where s.sf_store_id = h.store_id)
  ) then
    raise exception 'bk_hour_*: some rows belong to an SF store that no 營業 store links to';
  end if;
end $$;

alter table bk_hour_sales drop constraint bk_hour_sales_store_id_fkey;
alter table bk_hour_settings drop constraint bk_hour_settings_store_id_fkey;

update bk_hour_sales h set store_id = s.id from bk_sales_stores s where s.sf_store_id = h.store_id;
update bk_hour_settings h set store_id = s.id from bk_sales_stores s where s.sf_store_id = h.store_id;

alter table bk_hour_sales
  add constraint bk_hour_sales_store_id_fkey foreign key (store_id) references bk_sales_stores(id) on delete cascade;
alter table bk_hour_settings
  add constraint bk_hour_settings_store_id_fkey foreign key (store_id) references bk_sales_stores(id) on delete cascade;

-- the backup copies are developer-only too
alter table bk_hour_sales_bak_20261018 enable row level security;
alter table bk_hour_settings_bak_20261018 enable row level security;
create policy "developer manage bk_hour_sales_bak" on bk_hour_sales_bak_20261018 for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_hour_settings_bak" on bk_hour_settings_bak_20261018 for all using (is_developer()) with check (is_developer());

commit;
