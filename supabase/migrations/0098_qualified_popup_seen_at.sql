-- Jeff, 2026-10-08: "被qualified的員工，登入系統時中間會跳出視窗顯示
-- Congratulations! You have officially qualified as an Advanced staff
-- member." — a one-time congratulations popup the next time a newly
-- Qualified (Advanced) staff member logs in, mirroring the existing
-- title_loss_popup_seen_at / title_loss_at pair (added in migration 0096)
-- that drives the "you lost your title" popup in AppShell.jsx. Compared
-- against the already-existing profiles.qualified_at the same way: unseen
-- whenever it's null or older than qualified_at, so a later re-qualification
-- (disqualify -> recover) naturally re-shows it.
alter table public.profiles add column if not exists qualified_popup_seen_at timestamptz;
