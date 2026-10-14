-- BK auto-backup (Jeff, 2026-10-14). Run AFTER 0111_bk_sales.sql.
-- bk_backup_settings: single row (enabled flag + the day auto-backup was switched on).
-- bk_backup_log: one row per day. 'ok' = the 22:30 backup file was written;
-- 'failed' = tried and failed (error says why); 'acknowledged' = the user
-- dismissed the "missed" warning for that day. A day with no row after 22:30 is "missed".
-- The backup folder itself is a browser handle kept in that browser (IndexedDB), not in the DB.
create table bk_backup_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  enabled_since date,
  updated_at timestamptz not null default now()
);
insert into bk_backup_settings (id) values (1);
create table bk_backup_log (
  day date primary key,
  status text not null check (status in ('ok','failed','acknowledged')),
  file_name text,
  error text,
  finished_at timestamptz not null default now()
);
alter table bk_backup_settings enable row level security;
alter table bk_backup_log enable row level security;
create policy "developer manage bk_backup_settings" on bk_backup_settings for all using (is_developer()) with check (is_developer());
create policy "developer manage bk_backup_log" on bk_backup_log for all using (is_developer()) with check (is_developer());
