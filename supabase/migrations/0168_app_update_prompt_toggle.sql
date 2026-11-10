-- Jeff, 2026-11-10: "如果有更新版本可以在登入後10秒跳出有更新版本視窗要求更新嗎...在
-- admin centre的系統設定裡新增跳出更新視窗的開關，以防有做小修改就一直讓大家更新會增加
-- 困擾，所以admin可以累積幾個功能更新再打開視窗功能提醒大家更新" — one more column on the
-- existing app_display_settings singleton (migration 0091: everyone authenticated can
-- read it, only admins can write it), so AppShell.jsx can read it with the same query
-- shape RosterWeekTable already uses. Off by default: nobody sees the popup until an
-- admin turns it on in Admin Center > System Setting > "Update Available Popup".
-- My Information > Check for Updates is unaffected either way.
alter table app_display_settings
  add column if not exists update_prompt_enabled boolean not null default false;
