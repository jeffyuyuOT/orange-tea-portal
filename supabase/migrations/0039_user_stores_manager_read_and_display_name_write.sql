-- Applied directly via Supabase MCP during this session. Saved here after
-- the fact for the repo's migration history.
--
-- Fixes a genuine pre-existing RLS gap: a manager could not previously
-- SELECT another staff member's user_stores row for a store they manage
-- (only their own row, via "read own user_stores"), which multi-store
-- features (e.g. showing who else is assigned to a store) need. Unaffected
-- by the roster_display_name mistake in 0038/0041 — this stands on its own.

drop policy if exists "read own user_stores" on user_stores;

create policy "read accessible user_stores" on user_stores
  for select
  using (
    profile_id = auth.uid()
    or store_id = any (current_store_ids())
    or is_admin()
  );

create policy "manager update user_stores for own store" on user_stores
  for update
  using (is_manager_or_admin() and store_id = any (current_store_ids()))
  with check (is_manager_or_admin() and store_id = any (current_store_ids()));
