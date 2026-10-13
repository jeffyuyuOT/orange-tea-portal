-- BK U帳 分店transfer + 積欠 > 分店之間 (Jeff, 2026-10-13). Run AFTER 0108_bk_settlements.sql.
--
-- Point 1: 入金 (ruju) may now be negative — a withdrawal from the vault, added
-- back into UCOH. The old "must be positive unless icost/ucost" check blocked
-- this; ruju joins icost/ucost as an exception. (The math side already
-- handles a signed ruju correctly — bk_month_open_balances, bkDividend.js —
-- this is purely relaxing the data-entry guard.)
--
-- Point 2: 分店transfer — moving Ucost money between two BK stores in one go.
-- Always two bk_cash_entries rows, both kind 'ucost', linked by
-- transfer_group_id: the FROM store gets a POSITIVE amount (UCOH decreases)
-- and the TO store gets a NEGATIVE amount (UCOH increases) — Ucost already
-- nets into UCOH, so no changes needed to any money-math function. When the
-- transfer is 借貸償還 (a loan being repaid) rather than a plain transfer, each
-- side also gets its own independent row in bk_store_debts: the FROM store's
-- 借貸總額 and the TO store's 償還總額 — two separate running figures, each
-- store tracking only its own side, never netted against each other (Jeff's
-- choice, 2026-10-13).
--
-- bk_create_store_transfer() does both inserts (and, for 借貸償還, both debt
-- rows) in one statement so a transfer is never half-written. SECURITY
-- INVOKER, same as bk_seed_payment_types — still goes through the
-- is_developer() policies below (and on bk_stores, read to label the
-- descriptions).

alter table bk_cash_entries drop constraint bk_cash_entries_dw_ruju_positive;
alter table bk_cash_entries add constraint bk_cash_entries_dw_ruju_positive
  check (kind in ('icost', 'ucost', 'ruju') or amount > 0);

alter table bk_cash_entries
  add column transfer_group_id uuid,
  add column transfer_peer_store_id uuid references bk_stores(id),
  add column transfer_mode text check (transfer_mode in ('normal', 'loan_repay'));

alter table bk_cash_entries add constraint bk_cash_entries_transfer_fields check (
  (transfer_group_id is null) = (transfer_peer_store_id is null)
  and (transfer_group_id is null) = (transfer_mode is null)
  and (transfer_group_id is null or kind = 'ucost')
);
create index bk_cash_entries_transfer_group_idx on bk_cash_entries (transfer_group_id) where transfer_group_id is not null;

create table bk_store_debts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references bk_stores(id) on delete cascade,
  -- informational only (which store the other side of this record is); set
  -- null rather than blocking a store delete.
  peer_store_id uuid references bk_stores(id) on delete set null,
  kind text not null check (kind in ('borrow', 'repay')), -- borrow = 借貸 (FROM store), repay = 償還 (TO store)
  amount numeric(12, 2) not null check (amount > 0),
  entry_date date not null,
  note text,
  -- the bk_cash_entries leg this record came from; deleting that leg (e.g. the
  -- whole transfer being deleted) removes this record with it.
  source_entry_id uuid references bk_cash_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bk_store_debts_store_date_idx on bk_store_debts (store_id, entry_date);
create index bk_store_debts_source_entry_idx on bk_store_debts (source_entry_id);

alter table bk_store_debts enable row level security;
create policy "developer manage bk_store_debts" on bk_store_debts for all using (is_developer()) with check (is_developer());

create or replace function bk_create_store_transfer(
  p_from_store uuid, p_to_store uuid, p_mode text, p_date date, p_amount numeric, p_note text
) returns table (from_id uuid, to_id uuid)
language plpgsql security invoker as $$
declare
  v_group uuid := gen_random_uuid();
  v_from_name text;
  v_to_name text;
  v_from_id uuid;
  v_to_id uuid;
  v_from_desc text;
  v_to_desc text;
begin
  if p_from_store = p_to_store then
    raise exception 'from 分店和 to 分店不能相同';
  end if;
  if p_mode not in ('normal', 'loan_repay') then
    raise exception '未知的 transfer 類型';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception '金額必須大於 0';
  end if;
  if p_date is null then
    raise exception '請輸入日期';
  end if;

  select name into v_from_name from bk_stores where id = p_from_store;
  select name into v_to_name from bk_stores where id = p_to_store;
  if v_from_name is null or v_to_name is null then
    raise exception '找不到分店';
  end if;

  if p_mode = 'loan_repay' then
    v_from_desc := '借貸 → ' || v_to_name;
    v_to_desc := '償還 ← ' || v_from_name;
  else
    v_from_desc := '分店transfer → ' || v_to_name;
    v_to_desc := '分店transfer ← ' || v_from_name;
  end if;

  insert into bk_cash_entries
    (store_id, entry_date, kind, description, amount, note, transfer_group_id, transfer_peer_store_id, transfer_mode)
    values (p_from_store, p_date, 'ucost', v_from_desc, p_amount, p_note, v_group, p_to_store, p_mode)
    returning id into v_from_id;
  insert into bk_cash_entries
    (store_id, entry_date, kind, description, amount, note, transfer_group_id, transfer_peer_store_id, transfer_mode)
    values (p_to_store, p_date, 'ucost', v_to_desc, -p_amount, p_note, v_group, p_from_store, p_mode)
    returning id into v_to_id;

  if p_mode = 'loan_repay' then
    insert into bk_store_debts (store_id, peer_store_id, kind, amount, entry_date, note, source_entry_id)
      values (p_from_store, p_to_store, 'borrow', p_amount, p_date, p_note, v_from_id);
    insert into bk_store_debts (store_id, peer_store_id, kind, amount, entry_date, note, source_entry_id)
      values (p_to_store, p_from_store, 'repay', p_amount, p_date, p_note, v_to_id);
  end if;

  return query select v_from_id, v_to_id;
end;
$$;

-- Deleting either leg of a transfer deletes both (and their bk_store_debts
-- rows, via source_entry_id cascade). Called from the client in place of a
-- plain "delete from bk_cash_entries where id = ...": SECURITY INVOKER, same
-- is_developer() policies.
create or replace function bk_delete_store_transfer(p_entry_id uuid)
returns void language plpgsql security invoker as $$
declare
  v_group uuid;
begin
  select transfer_group_id into v_group from bk_cash_entries where id = p_entry_id;
  if v_group is null then
    delete from bk_cash_entries where id = p_entry_id;
  else
    delete from bk_cash_entries where transfer_group_id = v_group;
  end if;
end;
$$;
