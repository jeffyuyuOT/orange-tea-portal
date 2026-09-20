-- % of active formula items marked memorized at the moment this quiz was
-- submitted (0-100) — used to gate the "forced quiz every 10% of progress"
-- requirement: a new forced quiz is due once floor(currentPercent/10) is
-- greater than floor(this value/10) on the most recent attempt.
alter table quiz_attempts add column progress_snapshot integer;

-- A manager-set flag: a "senior" staff member is treated as having every
-- formula item memorized (current and future) without needing to tick each
-- one by hand.
alter table profiles add column is_senior boolean not null default false;
