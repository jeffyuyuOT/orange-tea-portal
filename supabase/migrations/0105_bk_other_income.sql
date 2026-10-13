-- BK follow-up (Jeff, 2026-10-13). Run AFTER 0104_bk_payment_type_copy.sql.
--
-- U帳 分店現金: a new 收支 kind, 其他收入 ('other_income'), shown under Ucost.
-- Other income only raises that day's "可 D 的最大金額":
--     max D of a day = that day's O.CA + the day's other income
-- and D typed for the day may not exceed it (checked by the page when saving).
-- It does NOT enter COH / UCOH / P/L (bk_month_open_balances ignores kinds it
-- does not list, so nothing to change there).
--
-- Amount is entered positive like deposit / withdraw / 入金 (the existing
-- bk_cash_entries_dw_ruju_positive check already requires amount > 0 for every
-- kind except icost / ucost).

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'bk_cash_entries'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%''withdraw''%'
      and pg_get_constraintdef(oid) like '%''deposit''%'
  loop
    execute format('alter table bk_cash_entries drop constraint %I', r.conname);
  end loop;
end $$;

alter table bk_cash_entries
  add constraint bk_cash_entries_kind_check
  check (kind in ('icost', 'ucost', 'deposit', 'withdraw', 'ruju', 'other_income'));
