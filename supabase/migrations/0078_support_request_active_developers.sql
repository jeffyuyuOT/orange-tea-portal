-- Jeff, 2026-09-29: a staff account submitting a Support Request got
-- "No active developer account to receive this — contact Jeff directly."
-- even though Jeff's own developer account is active. Same root cause as
-- 0077_roster_colleague_visibility.sql: SupportPage.jsx looks up
-- `profiles.select('id').eq('role','developer').eq('is_active', true)` as
-- the SUBMITTING user's own authenticated role, which is subject to the
-- same "read own or same-store profiles" RLS policy on `profiles` — a plain
-- staff account can only read its OWN row (or, if admin/shop_manager, any
-- row) — so this lookup silently came back empty for every non-admin/
-- manager submitter, regardless of whether a developer account actually
-- exists. admin/shop_manager submitting the exact same form never hit this,
-- since is_manager_or_admin() lets their query through.
--
-- Unlike the roster fix, this doesn't need per-store scoping or any
-- caller-side authorization check at all beyond being logged in: "which
-- account(s) are the developer/support inbox" isn't sensitive information,
-- and every authenticated submitter legitimately needs exactly this id
-- list to route their own request to it. A narrow SECURITY DEFINER
-- function returning just the `id` column (the same single column the
-- existing query already asked for) sidesteps `profiles` RLS without
-- exposing anything else about those accounts.

create or replace function active_developer_ids()
returns table (id uuid)
language sql stable security definer as $$
  select id from profiles where role = 'developer' and is_active = true
$$;

grant execute on function active_developer_ids() to authenticated;
