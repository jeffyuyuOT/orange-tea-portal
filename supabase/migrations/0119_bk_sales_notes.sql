-- BK 營業: date notes (Jeff, 2026-10-17). Run AFTER 0118.
--
-- A note on one store's day (click the date on the 營業 store sheet). Days with
-- a note get an icon; 歷史紀錄 › 營業 › Event lists them, and notes with the
-- same text are compared across years. Public holidays are NOT stored here —
-- they are read from the payroll app's stores (payroll_stores.data.publicHolidays).
--
-- Same security model as the other bk_* tables: RLS = is_developer().

create table bk_sales_notes (
  store_id uuid not null references bk_sales_stores(id) on delete cascade,
  day date not null,
  note text not null check (length(btrim(note)) > 0),
  updated_at timestamptz not null default now(),
  primary key (store_id, day)
);

alter table bk_sales_notes enable row level security;
create policy "developer manage bk_sales_notes" on bk_sales_notes for all using (is_developer()) with check (is_developer());
