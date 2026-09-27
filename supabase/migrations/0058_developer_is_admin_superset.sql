-- Bug found by Jeff testing the new developer role (migration 0057): the
-- front-end already treats 'developer' as "everything admin has, plus
-- Payroll" (permissions.js ROLE_DEFAULTS.developer = ALL), but the
-- DATABASE-level admin checks were still literal — is_admin()/
-- is_manager_or_admin() only ever matched role = 'admin', so a developer
-- account could see the admin-only pages in the UI but every actual
-- read/write against them (Store Management, User Management writes,
-- Formula Database editing, etc. — everything gated by is_admin() across
-- 10 earlier migrations) would still be rejected by RLS. This redefines
-- both shared helper functions to also match 'developer', so the DB-level
-- privilege boundary actually matches the front-end's "developer is
-- admin's superset" model everywhere, without having to touch each of
-- the many individual RLS policies that call them.
create or replace function is_admin()
returns boolean language sql stable security definer as $$
  select current_role_key() in ('admin', 'developer');
$$;

create or replace function is_manager_or_admin()
returns boolean language sql stable security definer as $$
  select current_role_key() in ('admin', 'shop_manager', 'developer');
$$;
