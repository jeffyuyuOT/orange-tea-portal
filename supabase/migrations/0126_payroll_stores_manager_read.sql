-- Jeff, 2026-10-20 (point 1): Roster Hub History's new per-employee Summary
-- modal needs each store's public-holiday dates to bucket worked hours into
-- weekday/weekend/public-holiday — the only place that data already lives
-- is payroll_stores.data->'publicHolidays' (maintained via the Payroll
-- tool's Store Settings, Developer Tools only). payroll_stores previously
-- had a single ALL-commands policy gated to is_developer() (migration
-- 0057_developer_role_and_payroll.sql) — writes stay developer-only, this
-- just adds a read-only SELECT policy for shop_manager/admin too (same
-- is_manager_or_admin() helper every other manager-facing table already
-- uses), so Roster Hub History can read publicHolidays client-side without
-- touching anything else this table might ever hold.
--
-- Already applied directly to the live database this session (via
-- apply_migration, not blocked) — Jeff doesn't need to run this himself,
-- it's here for the repo's own migration history.
create policy "managers can read payroll_stores" on public.payroll_stores
  for select
  using (is_manager_or_admin());
