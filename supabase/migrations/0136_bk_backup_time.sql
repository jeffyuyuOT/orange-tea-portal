-- BK auto-backup time (Jeff, 2026-10-23). Run AFTER 0112_bk_auto_backup.sql.
-- The nightly backup time (Brisbane, 'HH:MM') is now chosen in 系統設置 › 備份.
alter table bk_backup_settings add column if not exists backup_time text not null default '22:30'
  check (backup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
