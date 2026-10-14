-- BK 收成: every cost now says where it is paid from (Jeff, 2026-10-14). Run AFTER 0112.
--   bank  -> taken out of Jeff B
--   cash  -> taken out of Mao保
--   other -> taken out of 其他
-- Income rows (入金 typed on the 收成 tab) have no method. The table was empty
-- when this was added, so the check can require a method on every cost.
alter table bk_dividend_entries add column method text check (method in ('bank', 'cash', 'other'));
alter table bk_dividend_entries add constraint bk_dividend_entries_method_ck check ((kind = 'cost' and method is not null) or (kind = 'income' and method is null));
