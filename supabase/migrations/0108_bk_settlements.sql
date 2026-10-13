-- BK 分紅 > 分紅結算 records (Jeff, 2026-10-13). Run AFTER 0107_bk_dividend.sql.
--
-- A 分紅結算 is a reference calculation (per party: 可領取分紅 − 擁有金庫資產).
-- It never changes any vault or 分紅 figure, so it is stored as a snapshot of
-- the numbers that were on screen. store_id NULL = it was made on 全部分店.
-- status: 'saved' (儲存) or 'submitted' (提交).

create table bk_settlements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references bk_stores(id) on delete cascade,
  settle_date date not null,
  status text not null default 'saved' check (status in ('saved', 'submitted')),
  rows jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bk_settlements_store_date_idx on bk_settlements (store_id, settle_date);

alter table bk_settlements enable row level security;
create policy "developer manage bk_settlements" on bk_settlements for all using (is_developer()) with check (is_developer());
