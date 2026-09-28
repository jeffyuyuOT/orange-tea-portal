-- Removes the "Post and receive Bulletin messages" checkbox
-- (join_bulletin_activity, migrations 0065/0066), same day it shipped.
-- Jeff's reasoning: admin/manager already bypass the underlying RLS
-- entirely regardless of this flag (is_admin()/is_manager_or_admin() always
-- wins on every announcements policy), so it only ever actually restricted
-- a 'staff' account — and he decided that's rare enough not to need its
-- own toggle: "如果要讓staff不能po文的情形也很少，直接inactive就好". A
-- staff member who genuinely shouldn't use Bulletin at all now just gets
-- deactivated (is_active = false), same as blocking them from anything
-- else in the app.
--
-- Reverts every announcements-related policy this flag touched back to
-- its pre-0065 form (plain current_store_ids(), no bulletin_store_ids()
-- and no extra manager-fallback branch — that branch only existed to
-- compensate for the narrowing this migration undoes).

drop policy "read same-store announcements" on announcements;
create policy "read same-store announcements" on announcements for select using (
  store_id = any (current_store_ids()) or is_admin()
);

drop policy "staff insert own announcements" on announcements;
create policy "staff insert own announcements" on announcements
  for insert
  with check (
    current_role_key() = 'staff'
    and store_id = any (current_store_ids())
    and created_by = auth.uid()
  );

drop policy "read announcement_history" on announcement_history;
create policy "read announcement_history" on announcement_history for select using (
  exists (select 1 from announcements a where a.id = announcement_id and (a.store_id = any (current_store_ids()) or is_admin()))
);

drop policy "insert announcement_history" on announcement_history;
create policy "insert announcement_history" on announcement_history
  for insert
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from announcements a
      where a.id = announcement_history.announcement_id
      and (a.store_id = any (current_store_ids()) or is_admin())
    )
  );

drop policy "read announcement_comments" on announcement_comments;
create policy "read announcement_comments" on announcement_comments
  for select
  using (
    exists (
      select 1 from announcements a
      where a.id = announcement_comments.announcement_id
      and (a.store_id = any (current_store_ids()) or is_admin())
    )
  );

drop policy "insert own announcement_comments" on announcement_comments;
create policy "insert own announcement_comments" on announcement_comments
  for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from announcements a
      where a.id = announcement_comments.announcement_id
      and (a.store_id = any (current_store_ids()) or is_admin())
    )
  );

create or replace function set_complaint_solved(p_announcement_id uuid, p_solved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_category text;
  v_actor_name text;
begin
  select store_id, category into v_store_id, v_category
  from announcements where id = p_announcement_id;

  if v_category is null then
    raise exception 'Announcement not found';
  end if;
  if v_category <> 'customer_complaint' then
    raise exception 'Not a customer complaint';
  end if;
  if not (v_store_id = any (current_store_ids()) or is_admin()) then
    raise exception 'Not authorized for this store';
  end if;

  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  into v_actor_name
  from profiles where id = auth.uid();

  if p_solved then
    update announcements
    set solved = true, solved_by = auth.uid(), solved_by_name = coalesce(v_actor_name, ''), solved_at = now()
    where id = p_announcement_id;
  else
    update announcements
    set solved = false, solved_by = null, solved_by_name = null, solved_at = null
    where id = p_announcement_id;
  end if;

  insert into announcement_history (announcement_id, action, actor_id, actor_name)
  values (p_announcement_id, case when p_solved then 'solved' else 'reopened' end, auth.uid(), v_actor_name);
end;
$$;

-- Nothing references bulletin_store_ids() any more after the policy
-- reverts above — safe to drop it and the column it read.
drop function bulletin_store_ids();
alter table profiles drop column join_bulletin_activity;
