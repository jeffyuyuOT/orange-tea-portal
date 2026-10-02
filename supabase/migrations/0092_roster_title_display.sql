-- Jeff, 2026-10-02 (Training Journey spec, point 6): Phase E's roster/
-- bulletin title display needs every colleague's training_journey_phase
-- and has_master_title, the same way RosterWeekTable.jsx (shared by
-- Bulletin Board's Roster view and My Roster) already needs `qualified` —
-- but a plain staff viewer's `profiles` RLS only ever grants reading their
-- OWN row (migration 0077's store_roster_profiles() exists for exactly this
-- reason: a narrow SECURITY DEFINER function returning only the handful of
-- fields the roster view needs, never the real PII columns on `profiles`).
--
-- A SEPARATE function, not an extra two columns bolted onto
-- store_roster_profiles() itself — `returns table` can't gain new output
-- columns via CREATE OR REPLACE (only DROP + re-CREATE can change it), and
-- DROP FUNCTION on a function this many call sites already depend on is the
-- kind of statement worth keeping out of a routine schema change. One more
-- small RPC, called alongside the existing one, is simpler and safer here.
create or replace function store_roster_titles(p_store_id uuid)
returns table (
  id uuid,
  training_journey_phase smallint,
  has_master_title boolean
)
language sql stable security definer as $$
  select p.id, p.training_journey_phase, p.has_master_title
  from profiles p
  join user_stores us on us.profile_id = p.id
  where us.store_id = p_store_id
    and (p_store_id = any(current_store_ids()) or is_admin())
$$;

grant execute on function store_roster_titles(uuid) to authenticated;
