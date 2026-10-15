-- BK 收成: Party自身支出 (Jeff, 2026-10-15). Run AFTER 0114.
-- A new kind of row in bk_dividend_entries: 'party_expense' = something one
-- party spent on its own. It never touches the vault. On the 收成 tab that
-- party's total goes down by the amount and the same amount is added to the
-- other parties' totals in proportion to their weights.
--   party_id is required for 'party_expense' and empty for the other kinds.
--   The FK has no ON DELETE action, so a party that has such a row cannot be
--   deleted directly (deleting the whole store still cascades).
alter table bk_dividend_entries add column party_id uuid references bk_parties(id);
create index bk_dividend_entries_party_idx on bk_dividend_entries (party_id);

alter table bk_dividend_entries drop constraint if exists bk_dividend_entries_kind_check;
alter table bk_dividend_entries add constraint bk_dividend_entries_kind_check check (kind in ('income', 'cost', 'party_expense'));

-- 0113 required method on cost and none on income; party_expense has none either.
alter table bk_dividend_entries drop constraint if exists bk_dividend_entries_method_ck;
alter table bk_dividend_entries add constraint bk_dividend_entries_method_ck check ((kind = 'cost' and method is not null) or (kind <> 'cost' and method is null));

alter table bk_dividend_entries add constraint bk_dividend_entries_party_ck check ((kind = 'party_expense') = (party_id is not null));
