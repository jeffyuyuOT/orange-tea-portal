-- Jeff, 2026-10-01: "message可以刪除，並支持多重選擇的功能...訊息清單的訊息
-- 左邊顯示星星跟垃圾桶圖案。星星代表將此訊息標註成important，備標註成
-- important的訊息也會在important filter出現。垃圾桶代表刪除" — star
-- (Important) and delete, both per-viewer: a recipient starring/deleting
-- their own copy of a message must never touch the sender's copy or any
-- other recipient's copy.
--
-- A message already has one row per RECEIVING viewer (message_recipients),
-- so is_important/deleted_at land there for the Inbox/Important side. The
-- SENDER has no such per-viewer row today (a message only ever has one
-- sender) — their own Sent-list copy of "did I star/delete this" lives
-- directly on messages itself instead, as sender_is_important/
-- sender_deleted_at.
--
-- Soft delete (a timestamp, not an actual DELETE) — same "timestamp = a
-- per-viewer marker" shape read_at already uses, reversible, and avoids
-- ever needing a real DELETE RLS policy on either table.
alter table message_recipients add column is_important boolean not null default false;
alter table message_recipients add column deleted_at timestamptz;

alter table messages add column sender_is_important boolean not null default false;
alter table messages add column sender_deleted_at timestamptz;

-- message_recipients' existing "recipient marks own read" UPDATE policy
-- (using/with check: profile_id = auth.uid()) already covers ANY column on
-- their own row, so is_important/deleted_at need no new policy there.
--
-- messages itself has no UPDATE policy yet (only INSERT/SELECT) — add one
-- scoped to the sender only, for star/delete of their own Sent copy. Same
-- "only your own row" shape as every other single-owner policy in this
-- schema; still can't touch anyone else's message.
create policy "sender updates own message flags" on messages
  for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());
