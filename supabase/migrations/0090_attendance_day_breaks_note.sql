-- Follow-up to migration 0089: AttendanceCellEditModal.jsx always requires
-- a reason before saving ANY change in that modal, including a break-only
-- edit ("Edit break" mode) — but attendance_day_breaks had no column to
-- keep that reason in, so it was being silently discarded on save. Same
-- not-null-and-non-empty shape as attendance_event_edits.note (migration
-- 0062) for consistency.
alter table attendance_day_breaks add column if not exists note text not null default '' check (btrim(note) <> '');
