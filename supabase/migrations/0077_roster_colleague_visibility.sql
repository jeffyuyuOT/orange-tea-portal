-- Jeff, 2026-09-29: a plain 'staff' account viewing Bulletin Board's
-- store-wide Roster popup (RosterWeekTable.jsx, shared with My Roster) saw
-- EVERY colleague's name/shift time shown in red, as if nobody were
-- Qualified yet — while an admin/shop_manager account viewing the exact
-- same week saw it correctly (only genuinely not-yet-Qualified staff in
-- red).
--
-- Root cause: RosterWeekTable.jsx joins `profiles(qualified, ...)` onto
-- roster_entries and user_stores to color-code not-yet-Qualified staff. But
-- the `profiles` SELECT RLS policy ("read own or same-store profiles",
-- 0001_init.sql / 0060) only actually allows reading your OWN row, or ANY
-- row if you're admin/shop_manager (is_manager_or_admin()) — despite its
-- name, it never granted plain staff same-store read access. So for a
-- staff viewer, every colleague's embedded `profiles` came back null,
-- `qualified` read as undefined, and `!qualified` marked everyone red.
-- The same gap also silently dropped any colleague with zero shifts this
-- week from the "still show them on the grid" union (activeRoster below),
-- since that filter also depends on the blocked `profiles` embed
-- (is_active/role/join_store_activity) — so a staff viewer could see a
-- shorter staff list than admin/manager, not just wrong colors.
--
-- This is deliberately NOT fixed by widening the `profiles` RLS policy
-- itself — that table also carries real PII (tax_file_number,
-- date_of_birth, phone, email, address, bank_account_name, bsb,
-- account_number) that a colleague must never be able to read, and RLS in
-- Postgres is row-level, not column-level. Instead, a narrow SECURITY
-- DEFINER function (same pattern as accountant_visible_profile(), 0060)
-- returns only the handful of fields the roster view actually needs, gated
-- by the same store-membership check already used for
-- roster_entries/announcements (current_store_ids()) — so it can never be
-- used to read a colleague's sensitive fields, and can only be called for
-- a store the caller themselves currently has access to.

create or replace function store_roster_profiles(p_store_id uuid)
returns table (
  id uuid,
  first_name text,
  last_name text,
  is_active boolean,
  role text,
  qualified boolean,
  join_store_activity boolean
)
language sql stable security definer as $$
  select p.id, p.first_name, p.last_name, p.is_active, p.role, p.qualified, p.join_store_activity
  from profiles p
  join user_stores us on us.profile_id = p.id
  where us.store_id = p_store_id
    and (p_store_id = any(current_store_ids()) or is_admin())
$$;

grant execute on function store_roster_profiles(uuid) to authenticated;
