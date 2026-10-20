-- Jeff, 2026-10-21 (point 2): "BK的積欠Jeff下要可以切換分店(分店資料跟隨U帳
-- 分店)，目前的系統裡的資料是屬於sunnybank下" — bk_owed_jeff_entries (薪水
-- manual rows / 預付 / 預拿) had no store dimension at all; every row entered
-- so far was, in practice, Sunnybank's. Adds store_id (same bk_stores list
-- U帳/其他 BK tabs already switch between), backfills every existing row to
-- Sunnybank, then locks it not-null going forward.
--
-- The LIVE payroll-sourced 薪水 half (bk_jeff_payroll_salary(), unchanged by
-- this migration) stays a single company-wide total — Jeff's own call when
-- asked how to handle it post-switch ("只在sunnybank顯示"): the frontend
-- only shows those rows while Sunnybank is the selected store, nowhere else.

alter table bk_owed_jeff_entries add column if not exists store_id uuid references bk_stores(id);

update bk_owed_jeff_entries
set store_id = (select id from bk_stores where name = 'Sunnybank')
where store_id is null;

alter table bk_owed_jeff_entries alter column store_id set not null;

create index if not exists bk_owed_jeff_entries_store_idx on bk_owed_jeff_entries (store_id, kind, entry_date);
