-- BK 分紅 tab (Jeff, 2026-10-13). Run AFTER 0106_bk_o_post.sql.
--
-- 分紅 = sharing out the money that comes in as 入金, after cost, between the
-- "parties" of a store by weight. Three new tables (all per BK store, all
-- cascade away with the store, all RLS = is_developer() like the rest of BK):
--
--   bk_parties           the parties of ONE store and their weight in percent
--                        (the page checks that a store's weights add up to 100
--                        when saving 設定; the DB only keeps each between 0-100).
--   bk_dividend_entries  what is typed in on the 分紅 tab: extra 入金 ('income',
--                        counted as 其他) and cost ('cost'). Jeff B / Mao保 /
--                        其他 入金 coming from U帳 are NOT copied here: the page
--                        reads them straight from bk_cash_entries (kind 'ruju').
--   bk_payouts           分紅 actually paid to a party (bank or cash). A payout
--                        can be ticked 分紅結算 (is_settlement). Whether a
--                        settlement was a 分紅完全結算 (the vault reached zero
--                        with it) is worked out by the page from the dates, so
--                        editing or deleting an old record re-works it.
--
-- A party that has payouts cannot be deleted directly (the payouts FK has no
-- ON DELETE action = NO ACTION, checked at the end of the statement); deleting
-- a whole bk_store still removes everything in one go.

create table bk_parties (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references bk_stores(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  weight numeric(7, 3) not null check (weight >= 0 and weight <= 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bk_parties_store_name_unique on bk_parties (store_id, lower(btrim(name)));

create table bk_dividend_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references bk_stores(id) on delete cascade,
  entry_date date not null,
  kind text not null check (kind in ('income', 'cost')),
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bk_dividend_entries_store_date_idx on bk_dividend_entries (store_id, entry_date);

create table bk_payouts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references bk_stores(id) on delete cascade,
  party_id uuid not null references bk_parties(id),
  entry_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('bank', 'cash')),
  is_settlement boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bk_payouts_store_date_idx on bk_payouts (store_id, entry_date);
create index bk_payouts_party_idx on bk_payouts (party_id);

alter table bk_parties enable row level security;
alter table bk_dividend_entries enable row level security;
alter table bk_payouts enable row level security;

create policy "developer manage bk_parties" on bk_parties for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_dividend_entries" on bk_dividend_entries for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_payouts" on bk_payouts for all using (is_developer()) with check (is_developer());
