-- Restoring the Bulletin "Customer Complaint" category/solved feature and
-- announcement Delete/Retract button (previously built, then accidentally
-- reverted out of AnnouncementDetailModal.jsx by a later, unrelated commit
-- — see the OT Portal handoff doc). The `category`/`solved`/`solved_by`/
-- `solved_at`/`created_by_name`/`updated_by_name`/`actor_name` columns
-- already exist in this database from that earlier, undocumented change —
-- this migration only adds the two things that were actually still
-- missing (and would have made the original feature error out even before
-- it got reverted):
--
-- 1. `announcement_history.action` only allowed 'created'/'edited'/
--    'marked_important'/'unmarked_important' — logging a 'solved' or
--    'reopened' action (when a manager/admin toggles the Solved checkbox
--    on a Customer Complaint) would have violated this check constraint.
-- 2. Deleting an announcement (the Delete/Retract button) cascades into
--    `announcement_history` and `announcement_reads` (both `on delete
--    cascade`), but neither table had a DELETE policy — with RLS enabled
--    and no matching policy, that cascade delete would be blocked.

alter table announcement_history drop constraint if exists announcement_history_action_check;
alter table announcement_history add constraint announcement_history_action_check
  check (action in ('created', 'edited', 'marked_important', 'unmarked_important', 'solved', 'reopened'));

create policy "manager admin delete announcement_history" on announcement_history
  for delete
  using (
    exists (
      select 1 from announcements a
      where a.id = announcement_history.announcement_id
        and ((is_manager_or_admin() and a.store_id = any (current_store_ids())) or is_admin())
    )
  );

create policy "manager admin delete announcement_reads" on announcement_reads
  for delete
  using (
    exists (
      select 1 from announcements a
      where a.id = announcement_reads.announcement_id
        and ((is_manager_or_admin() and a.store_id = any (current_store_ids())) or is_admin())
    )
  );
