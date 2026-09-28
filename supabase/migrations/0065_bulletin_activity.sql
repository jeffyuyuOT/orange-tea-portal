-- Jeff, 2026-09: "post and receive Bulletin messages應該要從區分出來勾選" —
-- splits Bulletin Board participation at an "also belong to" (additional)
-- store into its OWN checkbox, separate from Join store activity (migration
-- 0064, which now only covers Manage Roster / leave / Roster Staff Order /
-- staff availability / Staff Information / Learning Tracker / Staff Time
-- Logs). Same shape/defaults reasoning as 0064: one flag per person, only
-- narrows ADDITIONAL stores, defaults true so no existing multi-store
-- person silently loses Bulletin access on this migration.
alter table profiles add column join_bulletin_activity boolean not null default true;

-- Mirrors active_store_ids() (migration 0064) exactly, keyed on the new
-- flag instead — the store(s) where this signed-in user counts as an
-- active Bulletin Board participant: can post there, and can see/receive
-- announcements (including customer complaints) posted there. Primary
-- store always counts, same as active_store_ids()/current_store_ids().
create or replace function bulletin_store_ids()
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(store_id), '{}')
  from (
    select primary_store_id as store_id from profiles where id = auth.uid() and primary_store_id is not null
    union
    select us.store_id
    from user_stores us
    join profiles p on p.id = us.profile_id
    where us.profile_id = auth.uid() and p.join_bulletin_activity
  ) s;
$$;

-- Receiving: everyone's own baseline visibility into announcements moves
-- from current_store_ids() to bulletin_store_ids(). Manager/admin are
-- unaffected in practice — they keep FULL read (and write) access to every
-- store they manage via the separate "manager admin write announcements"
-- ALL policy just below (untouched, still current_store_ids()-based);
-- Postgres RLS OR's every permissive policy together, so losing this one
-- narrower path never costs a manager anything they already have through
-- that one. This only actually narrows plain staff.
drop policy "read same-store announcements" on announcements;
create policy "read same-store announcements" on announcements for select using (
  store_id = any (bulletin_store_ids()) or is_admin()
);

-- (unchanged, reproduced from 0001_init.sql for reference — not re-created
-- here since it was never dropped)
-- create policy "manager admin write announcements" on announcements for all using (
--   (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
-- ) with check (
--   (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
-- );

-- Posting: was pointed at active_store_ids() in migration 0064's original
-- draft, before Jeff split the two checkboxes apart — moved here, at
-- bulletin_store_ids(), as its final home. Staff's own edit/delete rights
-- on posts they already made ("staff update/delete own announcements")
-- deliberately stay on current_store_ids() — Jeff's request was only about
-- post/receive, and someone who already posted somewhere shouldn't lose
-- the ability to fix/remove that specific post just because the checkbox
-- was toggled off afterwards.
drop policy "staff insert own announcements" on announcements;
create policy "staff insert own announcements" on announcements
  for insert
  with check (
    current_role_key() = 'staff'
    and store_id = any (bulletin_store_ids())
    and created_by = auth.uid()
  );

-- Same visibility gate on the supporting comment/history tables (migration
-- 0056), so someone who can no longer READ an announcement there can't see
-- its edit history or supplement comments either — each of these has its
-- own independent EXISTS check rather than delegating to the policy above,
-- so each needs the same bulletin_store_ids()-or-manager-or-admin logic
-- repeated. The "(is_manager_or_admin() and ... current_store_ids())"
-- branch is new here (these two tables previously had no manager-specific
-- read path at all — just the same current_store_ids() check as everyone
-- else) so a manager doesn't lose access to comments/history at a store
-- they manage just because their own Bulletin checkbox happens to be
-- unchecked there.
drop policy "read announcement_history" on announcement_history;
create policy "read announcement_history" on announcement_history for select using (
  exists (
    select 1 from announcements a
    where a.id = announcement_id
    and (
      a.store_id = any (bulletin_store_ids())
      or (is_manager_or_admin() and a.store_id = any (current_store_ids()))
      or is_admin()
    )
  )
);

drop policy "insert announcement_history" on announcement_history;
create policy "insert announcement_history" on announcement_history
  for insert
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from announcements a
      where a.id = announcement_history.announcement_id
      and (
        a.store_id = any (bulletin_store_ids())
        or (is_manager_or_admin() and a.store_id = any (current_store_ids()))
        or is_admin()
      )
    )
  );

drop policy "read announcement_comments" on announcement_comments;
create policy "read announcement_comments" on announcement_comments
  for select
  using (
    exists (
      select 1 from announcements a
      where a.id = announcement_comments.announcement_id
      and (
        a.store_id = any (bulletin_store_ids())
        or (is_manager_or_admin() and a.store_id = any (current_store_ids()))
        or is_admin()
      )
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
      and (
        a.store_id = any (bulletin_store_ids())
        or (is_manager_or_admin() and a.store_id = any (current_store_ids()))
        or is_admin()
      )
    )
  );

-- set_complaint_solved (0056) — "anyone who can see a customer complaint
-- can tick it Solved/Unsolved" — its authorization check tracks the same
-- visibility as the read policy above, now bulletin_store_ids()-based (+
-- the same manager fallback).
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
  if not (
    v_store_id = any (bulletin_store_ids())
    or (is_manager_or_admin() and v_store_id = any (current_store_ids()))
    or is_admin()
  ) then
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
