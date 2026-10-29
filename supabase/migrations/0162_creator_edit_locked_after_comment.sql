-- Jeff, 2026-10-30: "有edit權限的也要可以comment，manager的edit權限拿掉，
-- 只保留給admin跟發文者。發文者在有人comment之後就無法edit訊息(admin除外)"
--
-- Previously a single ALL policy ("manager admin write announcements")
-- gave any shop_manager/admin/developer full INSERT/UPDATE/DELETE/SELECT
-- on every announcement at their own store, with a parallel "staff
-- update own announcements" policy covering a plain staff creator's own
-- post only. That's being narrowed to:
--   - manager/admin/developer: UNCHANGED insert/delete rights (Jeff only
--     asked to remove EDIT, not the ability to post or moderate-delete).
--   - UPDATE (editing): admin/developer can always edit anything; a
--     shop_manager loses the "any post at this store" edit right
--     entirely; the post's own creator (whatever role — staff or
--     manager) can still edit, but only while no one has commented on it
--     yet — a normal announcement_comments row OR a merge-mode
--     'commented' announcement_history entry (migrations 0157/0159) both
--     count, since either way the post already has a reply on record.
--
-- Postgres RLS has no "ALL except UPDATE", so the old ALL policy is
-- split into one INSERT policy and one DELETE policy (identical
-- condition to before) plus the two new UPDATE policies below. Multiple
-- permissive UPDATE policies on the same table OR together, so admin's
-- policy being unconditional is exactly what makes admin exempt from the
-- creator's "no comments yet" lock — matching "(admin除外)" literally:
-- admin doesn't need the creator-only policy to pass at all.
--
-- Commenting itself (postComment/postMergedComment in
-- AnnouncementDetailModal.jsx) was never gated by edit rights in the
-- first place — the Comments section renders for anyone who can see the
-- post, independent of canEditThis — so "有edit權限的也要可以comment"
-- already held and needed no change here.
drop policy if exists "manager admin write announcements" on announcements;
drop policy if exists "staff update own announcements" on announcements;

create policy "manager admin insert announcements" on announcements
  for insert
  with check (
    (is_manager_or_admin() and store_id = any (current_store_ids()))
    or is_admin()
  );

create policy "manager admin delete announcements" on announcements
  for delete
  using (
    (is_manager_or_admin() and store_id = any (current_store_ids()))
    or is_admin()
  );

create policy "admin update announcements" on announcements
  for update
  using (is_admin())
  with check (is_admin());

create policy "creator update own announcements before comments" on announcements
  for update
  using (
    created_by = auth.uid()
    and store_id = any (current_store_ids())
    and not exists (select 1 from announcement_comments c where c.announcement_id = announcements.id)
    and not exists (
      select 1 from announcement_history h
      where h.announcement_id = announcements.id and h.action = 'commented'
    )
  )
  with check (
    created_by = auth.uid()
    and store_id = any (current_store_ids())
    and not exists (select 1 from announcement_comments c where c.announcement_id = announcements.id)
    and not exists (
      select 1 from announcement_history h
      where h.announcement_id = announcements.id and h.action = 'commented'
    )
  );
