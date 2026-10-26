-- Jeff, 2026-10-26: a shop manager (Brisbane One's manager) changed Roster Hub >
-- Setting > Message reminder, saw "Saved", but the day jumped back to Thursday.
-- Cause: stores can only be written by admin/developer (policy "admin manage
-- stores"), so a shop manager's UPDATE matched no row — it failed silently.
--
-- Rather than open up the whole stores table (a manager could then also change
-- audit_enabled, is_active, ...), this adds one narrow function: it changes
-- ONLY availability_reminder_weekday, and only for admin/developer or a shop
-- manager of that same store.
create or replace function set_availability_reminder_weekday(p_store_id uuid, p_weekday smallint)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_weekday is null or p_weekday < 0 or p_weekday > 6 then
    raise exception 'Weekday must be 0 (Sunday) to 6 (Saturday)';
  end if;
  if not (is_admin() or (current_role_key() = 'shop_manager' and p_store_id = any (current_store_ids()))) then
    raise exception 'You do not have permission to change this store''s reminder day';
  end if;
  update stores set availability_reminder_weekday = p_weekday where id = p_store_id;
  if not found then
    raise exception 'Store not found';
  end if;
  return p_weekday;
end;
$$;

revoke all on function set_availability_reminder_weekday(uuid, smallint) from public;
revoke all on function set_availability_reminder_weekday(uuid, smallint) from anon;
grant execute on function set_availability_reminder_weekday(uuid, smallint) to authenticated;
