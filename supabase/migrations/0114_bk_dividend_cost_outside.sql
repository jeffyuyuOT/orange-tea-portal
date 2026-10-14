-- BK 收成: a fourth cost method, 金庫外 (Jeff, 2026-10-14). Run AFTER 0113.
--   outside -> not taken out of any vault pot; only reduces the profit pool when 收成 is claimed.
alter table bk_dividend_entries drop constraint if exists bk_dividend_entries_method_check;
alter table bk_dividend_entries add constraint bk_dividend_entries_method_check check (method in ('bank', 'cash', 'other', 'outside'));
