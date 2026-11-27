-- Jeff, 2026-11-28: "approver的通知直接在message裡approve，要不然approver如果app沒有登出
-- 再登入就收不到approve的視窗" — the Message sent to the approver when a change request is
-- created now carries the request itself (Approve / Reject buttons inside the Message), so the
-- approver doesn't depend on the login pop-up. This links request -> its Message.
alter table schedule_change_requests
  add column if not exists message_id uuid references messages(id) on delete set null;

create index if not exists idx_schedule_change_requests_message on schedule_change_requests(message_id);
