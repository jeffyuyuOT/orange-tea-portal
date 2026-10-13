-- BK follow-up (Jeff, 2026-10-13). Run AFTER 0105_bk_other_income.sql.
--
-- Sales figure gets an O.POST column right after O.CA: the total printed on the
-- POS report (the image import's "Total" goes here). The main payment type
-- 'Pos total' is no longer typed — like Cash it is calculated:
--     Pos total = O.POST - D        (no D that day -> Pos total = O.POST)
-- Total (= Pos total + Self order kiosk) and Sum vs Total are unchanged.
--
-- Pos total amounts typed before this change stay in bk_sf_days.amounts but are
-- no longer read; re-enter them as O.POST (O.POST = old Pos total + D).
--
-- Same security model as 0101: RLS = is_developer() (no new table).

alter table bk_sf_days add column if not exists o_post numeric(12, 2);
