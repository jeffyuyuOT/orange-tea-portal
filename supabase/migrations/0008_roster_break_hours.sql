-- Break length for a shift, in HALF-HOUR units (e.g. 1 = 30 min, 2 = 1 hr) —
-- matching how the manager already writes it in the Excel roster (the
-- number under a day's "Break" row). Needed so Manage Roster can show the
-- same Name / Break-row layout, and compute each person's paid Total hr
-- (shift length minus break) and weekend hr (Sat+Sun paid hours)
-- automatically. Stored as entered (half-hour units), not converted to
-- hours, so it round-trips exactly with the Excel template/export.
alter table roster_entries add column if not exists break_half_hours numeric;
