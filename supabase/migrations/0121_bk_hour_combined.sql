-- BK 小時統計: already-summed hourly figures (Jeff, 2026-10-17). Run AFTER 0120.
--
-- Older months only exist as an Excel sheet of hourly totals (POS + self-order
-- already added together), so they can't be split into pos_* / self_*. They go
-- into combined_sales. On screen a row's 營業額 is pos_sales + self_sales when
-- either is present, and combined_sales otherwise (so importing the POS /
-- self-order reports later takes over without double counting).

alter table bk_hour_sales add column combined_sales numeric(12, 2);
