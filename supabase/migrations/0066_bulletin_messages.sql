-- Jeff, 2026-09: Bulletin Board "Message" tab — private, multi-recipient
-- messages between same-store users, picked from a list excluding
-- training/qr_code_maker/accountant (admin stays pickable — confirmed with
-- Jeff, who initially also said "admin" but then corrected: "exclude
-- training, accountant and 2d maker only"). Distinct from `announcements`,
-- which are always a whole-store broadcast with no single-recipient
-- concept — reusing that table wasn't an option here.
--
-- Jeff's own words: "message的內容只有相關的寄件收件者看的到，admin跟
-- manager若不相關也看不到" — deliberately NO is_admin()/is_manager_or_admin()
-- bypass anywhere on these two tables, unlike almost everywhere else in
-- this schema (see e.g. "read same-store announcements", which always lets
-- is_admin() through). An uninvolved admin/manager genuinely cannot read
-- someone else's private message here.
--
-- Confirmed with Jeff: a reply from the (not yet built) HR/Admin Request
-- Database also lands here, as a private Message to the submitter, rather
-- than as a store-wide announcement — this table is built to support that
-- reuse once Support is built on top of it (see the not-yet-written
-- Support migration for how "OT HR Department"/"OT admin" sender names and
-- the case-number cross-reference get layered on top of a plain message
-- row, probably via a nullable `support_request_id` column added then).

create table messages (
  id uuid primary key default gen_random_uuid(),
  -- The store this message was composed in — recipients are picked from
  -- the sender's current store's membership, so this is mostly bookkeeping/
  -- indexing rather than an access-control boundary in its own right
  -- (actual visibility is entirely per-recipient, via message_recipients).
  store_id uuid not null references stores(id) on delete cascade,
  sender_id uuid references profiles(id),
  -- Permanent text snapshot (same pattern as created_by_name elsewhere in
  -- this schema) so a message still shows who sent it after that account
  -- is later removed.
  sender_name text not null,
  subject text not null,
  content_html text,
  -- Set when this message is a reply/reply-all/forward of another — lets
  -- the UI show "Re:"/"Fwd:" context and a link back to the original,
  -- without needing a full threaded-conversation model (Jeff only asked
  -- for reply/reply-all/forward each producing one new message, not a
  -- nested thread view).
  in_reply_to uuid references messages(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_messages_store on messages(store_id);
create index idx_messages_in_reply_to on messages(in_reply_to);

create table message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  -- Null = unread. Per-recipient, same "New"/read-marker shape as
  -- announcement_reads elsewhere in this schema — drives this message's
  -- unread dot for THIS person only, independent of every other recipient.
  read_at timestamptz,
  unique (message_id, profile_id)
);

create index idx_message_recipients_profile on message_recipients(profile_id);
create index idx_message_recipients_message on message_recipients(message_id);

alter table messages enable row level security;
alter table message_recipients enable row level security;

-- Read: the sender, or any recipient. Deliberately NOT is_admin()/
-- is_manager_or_admin() — see the migration comment above.
create policy "read own sent or received messages" on messages
  for select using (
    sender_id = auth.uid()
    or exists (select 1 from message_recipients mr where mr.message_id = messages.id and mr.profile_id = auth.uid())
  );

-- Send: sender_id must be the caller, at a store they currently have
-- access to (same store-scoping every other write in this schema uses).
create policy "send own messages" on messages
  for insert
  with check (sender_id = auth.uid() and store_id = any (current_store_ids()));

-- Recipients: your own row, the sender (needs the full recipient list to
-- render "To:" and to power Reply All), or a CO-recipient (so a recipient
-- replying "Reply All" can see who else got it too) — same "no admin
-- bypass" reasoning as the messages policy above.
create policy "read message recipients" on message_recipients
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from messages m where m.id = message_recipients.message_id and m.sender_id = auth.uid())
    or exists (
      select 1 from message_recipients mine
      where mine.message_id = message_recipients.message_id and mine.profile_id = auth.uid()
    )
  );

-- Only the sender of the parent message can add recipient rows — i.e. only
-- while sending their own message.
create policy "sender adds recipients" on message_recipients
  for insert
  with check (
    exists (select 1 from messages m where m.id = message_recipients.message_id and m.sender_id = auth.uid())
  );

-- A recipient marks their own copy read — the only thing the UI ever
-- writes here.
create policy "recipient marks own read" on message_recipients
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
