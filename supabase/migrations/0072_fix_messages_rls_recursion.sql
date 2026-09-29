-- Jeff, 2026-09: submitting a Support request threw "Error: infinite
-- recursion detected in policy for relation "messages"".
--
-- Root cause: `messages` and `message_recipients` (migration
-- 0066_bulletin_messages.sql) check EACH OTHER directly inside their own
-- RLS policies — messages' SELECT policy EXISTS-queries message_recipients
-- to see if you're a recipient, while message_recipients' SELECT policy
-- EXISTS-queries messages back (to let the sender see their own recipient
-- list) AND EXISTS-queries itself (so a co-recipient can see who else got
-- the message). That's a genuine circular dependency between the two
-- tables' policies (plus a self-reference on message_recipients), and
-- support_requests' own policies (migration 0069_support_requests.sql) make
-- it worse by JOINing messages and message_recipients together in ONE
-- query to decide who can read/complete a case — which is exactly the
-- Support submit flow (insert the case, then read it straight back) and
-- forces Postgres to evaluate all three tables' RLS at once, which is what
-- actually trips the "infinite recursion detected" guard (a plain Message
-- compose/inbox read apparently never happened to force all three together
-- the same way, which is why this went unnoticed since 0066/0069 shipped).
--
-- Fix: this schema already has an established, working pattern for exactly
-- this shape of problem — current_store_ids()/is_admin() (migration 0001)
-- are `security definer` functions specifically so a policy can look at
-- another (or the same) RLS-protected table without re-triggering that
-- table's own RLS, which is what breaks a cycle like this instead of just
-- relocating it. Wrapping the cross-table (and self-table) lookups below in
-- the same kind of function fixes this the same way.

create or replace function is_message_sender(msg_id uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from messages m where m.id = msg_id and m.sender_id = auth.uid());
$$;

create or replace function is_message_recipient(msg_id uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from message_recipients mr where mr.message_id = msg_id and mr.profile_id = auth.uid());
$$;

create or replace function is_support_request_recipient(req_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from messages m
    join message_recipients mr on mr.message_id = m.id
    where m.support_request_id = req_id and mr.profile_id = auth.uid()
  );
$$;

-- messages: same rule as before (sender, or a recipient — still no
-- is_admin()/is_manager_or_admin() bypass, per Jeff's original "只有相關的
-- 寄件收件者看的到" design), just via the function instead of an inline
-- EXISTS on message_recipients.
drop policy if exists "read own sent or received messages" on messages;
create policy "read own sent or received messages" on messages
  for select using (sender_id = auth.uid() or is_message_recipient(id));

-- message_recipients: same three cases as before (your own row, the
-- sender, a co-recipient), just via functions instead of inline EXISTS on
-- messages/message_recipients themselves.
drop policy if exists "read message recipients" on message_recipients;
create policy "read message recipients" on message_recipients
  for select using (
    profile_id = auth.uid()
    or is_message_sender(message_id)
    or is_message_recipient(message_id)
  );

drop policy if exists "sender adds recipients" on message_recipients;
create policy "sender adds recipients" on message_recipients
  for insert
  with check (is_message_sender(message_id));

-- support_requests: same rule as before (whoever opened it, or whoever
-- received the message it's attached to), just via the function instead of
-- the inline messages/message_recipients join.
drop policy if exists "read own or received support_requests" on support_requests;
create policy "read own or received support_requests" on support_requests
  for select using (submitted_by = auth.uid() or is_support_request_recipient(id));

drop policy if exists "recipient marks support_requests complete" on support_requests;
create policy "recipient marks support_requests complete" on support_requests
  for update
  using (is_support_request_recipient(id))
  with check (is_support_request_recipient(id));
