-- Jeff, 2026-10-16: relocates the training-hours-exceeded reminder out of
-- Bulletin entirely — the staff member's own reminder becomes a one-time-
-- per-band login popup (AppShell.jsx), and the manager-facing half becomes
-- a system Message to that store's admin/shop_manager/developer
-- (BulletinPage.jsx) instead of a Bulletin card. Both need their own
-- "which band have we already told this person about" marker so the
-- computed-fresh-every-load band math (trainingHoursReminder.js) doesn't
-- re-fire for a band already shown/sent. Nullable, defaults to untouched —
-- a profile that's never crossed 50 hours (or is already qualified) simply
-- never gets either column set.
alter table public.profiles
  add column training_hours_popup_seen_band integer,
  add column training_hours_notified_band integer;
