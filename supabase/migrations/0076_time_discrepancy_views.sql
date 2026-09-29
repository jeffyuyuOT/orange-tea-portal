-- Jeff, 2026-09: "staff time logs如果有員工的time logs算出的時間跟班表上算
-- 出來的時間的有出入15mins以上，該員名字會顯示提示，點擊名字進去後會顯示出
-- 入的資訊是什麼，staff time logs那裏也會有紅點提示。這些提示閱讀完後即消
-- 失(跟隨user, userA看過後並不會影響user B的提示)" — a staff member's name
-- gets an alert marker in Staff Time Logs when their clocked hours differ
-- from their (published) rostered hours by 15+ minutes on some day in the
-- recent window; opening their record clears it — but only for the manager/
-- admin who opened it, per Jeff's explicit "跟隨user" — someone else looking
-- at the same staff member still sees their own, independent alert.
--
-- The discrepancy itself (which days, how far off) is computed live in the
-- app from roster_entries + attendance_events — there's nothing to store
-- for that. What DOES need storing is the one thing that's genuinely
-- per-person: each manager/admin's own "I've seen this person's current
-- discrepancy" cursor. Same shape/reasoning as roster_period_views
-- (migration 0048) — a per-viewer read marker, not a per-subject one.
--
-- "Unread" is decided client-side by comparing this viewed_at against the
-- most recent signal that could have produced/changed the discrepancy for
-- that subject — the latest of that profile's own attendance_events.created_at
-- and roster_change_events.changed_at (both already timestamped, no new
-- columns needed elsewhere) — so correcting a punch or re-publishing a
-- changed roster re-flags it even if this manager had already cleared it
-- once before.
create table if not exists time_discrepancy_views (
  viewer_id uuid not null references profiles(id) on delete cascade,
  subject_profile_id uuid not null references profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (viewer_id, subject_profile_id)
);

alter table time_discrepancy_views enable row level security;

-- Purely a personal "have I looked at this person's discrepancy" cursor —
-- only the viewer themselves ever needs to read or write their own rows.
create policy "own time_discrepancy_views" on time_discrepancy_views
  for all using (viewer_id = auth.uid()) with check (viewer_id = auth.uid());
