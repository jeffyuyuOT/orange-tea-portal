-- BK 小時統計 (Jeff, 2026-10-17). Run AFTER 0119.
--
-- 1) bk_hour_settings: which hours each store shows on the 小時統計 page
--    (系統設置 › 小時統計). Stores are bk_stores — the same list SF and U帳 use.
--    No row = the app's default (9:00–21:59). start_hour / end_hour are the first
--    and last hour shown (0–23, end inclusive).
-- 2) bk_hour_sales: one row per store / day / hour. Two sources are stored side by
--    side and added together on screen: the POS "Sales By Hour" report (pos_*) and
--    the self-order "Store Performance Report" (self_*). *_sales = dollars,
--    *_count = the report's Count / Order Count.
--
-- Same security model as the other bk_* tables: RLS = is_developer().

create table bk_hour_settings (
  store_id uuid primary key references bk_stores(id) on delete cascade,
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 0 and 23),
  updated_at timestamptz not null default now(),
  check (start_hour <= end_hour)
);

create table bk_hour_sales (
  store_id uuid not null references bk_stores(id) on delete cascade,
  day date not null,
  hour smallint not null check (hour between 0 and 23),
  pos_sales numeric(12, 2),
  pos_count integer,
  self_sales numeric(12, 2),
  self_count integer,
  updated_at timestamptz not null default now(),
  primary key (store_id, day, hour)
);
create index bk_hour_sales_day_idx on bk_hour_sales (day);

alter table bk_hour_settings enable row level security;
alter table bk_hour_sales enable row level security;
create policy "developer manage bk_hour_settings" on bk_hour_settings for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_hour_sales" on bk_hour_sales for all using (is_developer()) with check (is_developer());
