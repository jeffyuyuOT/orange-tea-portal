-- Jeff asked for staff (not just admin/shop_manager) to be able to post to
-- the Bulletin Board. Confirmed scope with Jeff:
--   1. Staff can create announcements/customer complaints at their own
--      store(s), and can edit/delete only the ones THEY created — manager/
--      admin keep their existing, separate "manager admin write
--      announcements" ALL policy (anyone's post at their store).
--   2. Anyone who can see an announcement/complaint (staff included) can
--      add a "supplement" comment underneath it, regardless of who posted
--      it — a new lightweight comment thread (announcement_comments),
--      separate from the existing edit-history log and separate from
--      editing the post's own title/content.
--   3. Anyone who can see a customer complaint (staff included) can tick
--      it Solved/Unsolved, regardless of who posted it — via a narrow
--      security-definer function (set_complaint_solved) rather than a
--      broad UPDATE grant, so this doesn't also let staff rewrite someone
--      else's complaint title/content.
--   4. Manager/admin get a "View history" (觀看紀錄) look at exactly who
--      has opened a given announcement/complaint — the pre-existing
--      announcement_reads table already has everything needed
--      (profile_id, announcement_id, read_at); it just needed a SELECT
--      policy letting manager/admin enumerate everyone else's rows for
--      their store, not only their own.
--   5. The Bulletin Board's announcement/customer-complaint items (and the
--      two filter tabs) get the same per-person "New"/"Update" + small-dot
--      treatment the Roster tab already has (migration 0048), reusing
--      announcement_reads as the read-marker: "New" if there's no row at
--      all yet, "Update" if announcements.updated_at is newer than that
--      row's read_at. (Front-end only — BulletinPage.jsx/
--      AnnouncementDetailModal.jsx — no schema change needed for this
--      part.)

-- 1. Staff can create their own announcements/complaints at a store they
--    belong to.
create policy "staff insert own announcements" on announcements
  for insert
  with check (
    current_role_key() = 'staff'
    and store_id = any (current_store_ids())
    and created_by = auth.uid()
  );

-- Staff can edit/delete ONLY the posts they created themselves.
create policy "staff update own announcements" on announcements
  for update
  using (
    current_role_key() = 'staff'
    and created_by = auth.uid()
    and store_id = any (current_store_ids())
  )
  with check (
    current_role_key() = 'staff'
    and created_by = auth.uid()
    and store_id = any (current_store_ids())
  );

create policy "staff delete own announcements" on announcements
  for delete
  using (
    current_role_key() = 'staff'
    and created_by = auth.uid()
    and store_id = any (current_store_ids())
  );

-- 2. Broaden announcement_history inserts: previously only manager/admin
--    could log a history row at all, which blocked staff from logging
--    their own "created"/"edited" entries. Anyone who can already see the
--    parent announcement (their store, or admin) can log a history row
--    attributed to themselves.
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

-- 3. New: a lightweight "supplement" comment thread on announcements/
--    complaints, open to anyone who can see the parent post (staff
--    included) — separate from the edit-history log, and separate from
--    editing the post's own title/content (which stays restricted to the
--    creator + manager/admin per the policies above).
create table announcement_comments (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  author_name text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table announcement_comments enable row level security;

create policy "read announcement_comments" on announcement_comments
  for select
  using (
    exists (
      select 1 from announcements a
      where a.id = announcement_comments.announcement_id
      and (a.store_id = any (current_store_ids()) or is_admin())
    )
  );

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

create policy "manager admin delete announcement_comments" on announcement_comments
  for delete
  using (
    exists (
      select 1 from announcements a
      where a.id = announcement_comments.announcement_id
      and ((is_manager_or_admin() and a.store_id = any (current_store_ids())) or is_admin())
    )
  );

-- 4. Let anyone who can see a customer complaint (staff included) tick it
--    Solved/Unsolved, without opening up full UPDATE rights on the row
--    (which would also let staff rewrite someone else's title/content).
--    SECURITY DEFINER so it can write the row internally, but it does its
--    own explicit store-membership + category check up front, and only
--    ever touches the solved-related columns.
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

grant execute on function set_complaint_solved(uuid, boolean) to authenticated;

-- 5. Let manager/admin enumerate everyone's read receipts for their
--    store's announcements (previously each person could only see their
--    OWN read row) — powers the new "View history" (觀看紀錄) list of
--    who's opened a given announcement/complaint. Also reused, with each
--    person reading only their own row as before, to drive the
--    New/Update badges on the Bulletin Board list itself.
create policy "manager admin read announcement_reads" on announcement_reads
  for select
  using (
    exists (
      select 1 from announcements a
      where a.id = announcement_reads.announcement_id
      and ((is_manager_or_admin() and a.store_id = any (current_store_ids())) or is_admin())
    )
  );
