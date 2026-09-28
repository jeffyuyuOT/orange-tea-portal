-- Jeff, 2026-09: "新增Support分頁" — a plain submission form (title + rich
-- content, images included via the same inline-image editor everything
-- else already uses) that opens a Support case. Rides on top of the
-- existing private messages/message_recipients system (migration
-- 0066_bulletin_messages.sql) rather than building a second inbox: the
-- submission becomes an ordinary private message from the submitter to
-- every active `developer`-role account (today just Jeff Chuang, but this
-- doesn't hardcode that — see SupportPage.jsx), so it shows up in the
-- submitter's own Message > Sent tab and the developer's Message > Inbox
-- tab for free, with the case number in the subject line, no separate
-- "Support inbox" page needed.
--
-- support_requests carries the case number + completion status;
-- `messages` gets one new nullable column (support_request_id) linking a
-- message back to its case, purely so the Message list/detail views can
-- show the Case #/Incomplete/Complete badge — see MessagePage.jsx /
-- MessageDetailModal.jsx.
create sequence support_case_number_seq start 1;

create table support_requests (
  id uuid primary key default gen_random_uuid(),
  case_number int not null default nextval('support_case_number_seq') unique,
  submitted_by uuid references profiles(id),
  -- Permanent text snapshot (same pattern as created_by_name elsewhere)
  -- so a case still shows who opened it after that account is later
  -- removed.
  submitted_by_name text not null,
  store_id uuid not null references stores(id) on delete cascade,
  title text not null,
  content_html text,
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table messages add column support_request_id uuid references support_requests(id) on delete set null;
create index idx_messages_support_request on messages(support_request_id);

alter table support_requests enable row level security;

-- Read: whoever opened it, or whoever can read the message it's attached
-- to (i.e. a recipient of that message — in practice the developer
-- account(s) it was sent to). Deliberately NOT is_admin()/
-- is_manager_or_admin() — same "no bypass" privacy design as messages/
-- message_recipients themselves (Jeff: "message的內容只有相關的寄件收件者
-- 看的到，admin跟manager若不相關也看不到" — a Support case rides on a
-- message, so it inherits the same rule). Submitting (see the insert
-- policy below) never needs the message to exist yet — that branch alone
-- covers reading the freshly-inserted row straight back, before the
-- message/message_recipients rows that link to it are created a moment
-- later in the same submit flow.
create policy "read own or received support_requests" on support_requests
  for select using (
    submitted_by = auth.uid()
    or exists (
      select 1 from messages m
      join message_recipients mr on mr.message_id = m.id
      where m.support_request_id = support_requests.id and mr.profile_id = auth.uid()
    )
  );

-- Submit: your own case, at a store you currently have access to (same
-- store-scoping every other write in this schema uses).
create policy "submit own support_requests" on support_requests
  for insert
  with check (submitted_by = auth.uid() and store_id = any (current_store_ids()));

-- Only whoever the linked message was actually sent to (the developer
-- account(s)) can flip completed — never the submitter, and never a
-- blanket is_admin()/developer-role check, so this naturally covers
-- whichever account(s) the case actually went to, per Jeff: "訊息裡
-- developer可以勾選已完成，勾選並確認在該request在清單裡顯示complete。取
-- 消勾選則變回incomplete".
create policy "recipient marks support_requests complete" on support_requests
  for update
  using (
    exists (
      select 1 from messages m
      join message_recipients mr on mr.message_id = m.id
      where m.support_request_id = support_requests.id and mr.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from messages m
      join message_recipients mr on mr.message_id = m.id
      where m.support_request_id = support_requests.id and mr.profile_id = auth.uid()
    )
  );
