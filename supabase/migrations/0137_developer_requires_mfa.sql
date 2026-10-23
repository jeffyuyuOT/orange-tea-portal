-- Jeff, 2026-10-24: BK / Payroll data must need the second factor at the DATABASE
-- level, not just the RequireTwoFactor screen. is_developer() is used ONLY by the
-- bk_* and payroll_* RLS policies (checked in pg_policies; all bk_* functions are
-- SECURITY INVOKER so they follow the same policies). A session that has not passed
-- the TOTP challenge (aal1) now reads/writes nothing there, even with the right password.
-- Edge Functions (service role) and the SQL Editor are not affected.
--
-- ROLLBACK (if anything unexpected): run
--   create or replace function is_developer() returns boolean language sql stable security definer as $$
--     select current_role_key() = 'developer';
--   $$;
create or replace function is_developer()
returns boolean language sql stable security definer as $$
  select current_role_key() = 'developer'
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
