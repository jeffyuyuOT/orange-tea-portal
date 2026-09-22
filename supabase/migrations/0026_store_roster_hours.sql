-- Each store's actual opening/closing time, so Roster Hub > Setting's
-- weekly timeline can be scaled to just the hours the store is open
-- instead of always drawing a full 0:00-24:00 axis with a big empty gap
-- before opening. Nullable — a store that hasn't set these yet just keeps
-- showing the full 24-hour axis (see RosterSettingsPage.jsx's fallback).
alter table stores add column if not exists roster_open_time time;
alter table stores add column if not exists roster_close_time time;
