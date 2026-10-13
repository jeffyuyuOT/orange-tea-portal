-- BK follow-up (Jeff, 2026-10-13). Run AFTER 0103_bk_pos_total.sql.
--
-- Payment type settings gain two checkboxes:
--   * 鎖定 (is_locked, already exists)  — a locked type cannot be deleted. It can
--     now be switched on/off for ANY type, including Cash / Total Eftpos / Pos
--     total / Self order kiosk (the SF formulas find those by NAME, not by the
--     lock flag, so unlocking never changes a calculation).
--   * 可複製資料 (can_copy, new)       — the SF column header shows a copy icon that
--     puts the whole month's column on the clipboard (for pasting into Excel).
--
-- Nothing else changes; RLS (is_developer()) already covers the table.

alter table bk_payment_types add column if not exists can_copy boolean not null default false;
