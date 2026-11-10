-- Jeff, 2026-11-10: "系統設置的開關會彈出視窗顯示更新了哪些，有看過的就不會列出，因為都會悄悄
-- 更新了，只是不想一直彈出更新視窗讓大家覺得很煩，所以admin可以控制累積一定量再彈出視窗" — one more
-- column on the existing app_display_settings singleton (migration 0091: everyone authenticated can
-- read it, only admins can write it), so AppShell.jsx can read it with the same query shape
-- RosterWeekTable already uses. It switches the "What's new" popup (lib/releaseNotes.js) on or off;
-- the app itself updates quietly either way. Off by default: nobody sees the popup until an admin
-- turns it on in Admin Center > System Setting > "What's New Popup".
alter table app_display_settings
  add column if not exists update_prompt_enabled boolean not null default false;
