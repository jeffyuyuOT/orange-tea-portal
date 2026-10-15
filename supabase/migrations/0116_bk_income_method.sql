-- BK 收成: 入金 typed on the 收成 tab now says which vault pot it goes into
-- (Jeff, 2026-10-15). Run AFTER 0115.
--   bank  -> Jeff B
--   cash  -> Mao保
--   other -> 其他 (also what an older 入金 row with no method counts as)
-- cost still needs a method (0113); party_expense has none.
alter table bk_dividend_entries drop constraint if exists bk_dividend_entries_method_ck;
alter table bk_dividend_entries add constraint bk_dividend_entries_method_ck check (
  (kind = 'cost' and method is not null)
  or (kind = 'income' and (method is null or method in ('bank', 'cash', 'other')))
  or (kind = 'party_expense' and method is null)
);
