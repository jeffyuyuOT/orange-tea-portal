-- Jeff, 2026-10-30 (bug report): a staff member trying to post a comment on
-- a merge-mode notice got "Could not post comment: new row for relation
-- "announcement_history" violates check constraint
-- "announcement_history_action_check"" — migration 0157's
-- append_merged_comment() inserts action = 'commented', but
-- announcement_history has a CHECK constraint (added back when the table
-- was first created) only allowing
-- ('created','edited','marked_important','unmarked_important','solved',
-- 'reopened'). 0157 added the new ACTION VALUE everywhere else (the RPC,
-- and the History list's display, which already renders any action with
-- no underscore as "<action> by <name>" with no code change needed) but
-- missed this constraint, so every merge-mode comment was failing at the
-- very last step, after the content_html append had already gone through
-- — content_html is updated BEFORE this insert inside
-- append_merged_comment(), both in the same function, and the function
-- is one single implicit transaction, so the content never actually got
-- appended either; the whole RPC rolled back together with this insert.
alter table announcement_history drop constraint if exists announcement_history_action_check;

alter table announcement_history add constraint announcement_history_action_check
  check (action = any (array['created', 'edited', 'marked_important', 'unmarked_important', 'solved', 'reopened', 'commented']));
