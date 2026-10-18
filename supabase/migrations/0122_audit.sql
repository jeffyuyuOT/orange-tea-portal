-- Jeff, 2026-10-18: "新增Audit分頁" — per-store audit checklists.
--
--   audit_items         the "Settings" list: what a store's audit sheet contains
--                       (title + details + optional File Repository file).
--                       Edited by admin/developer only.
--   audit_reports       one audit sheet. draft -> pending_confirmation (admin
--                       submitted, shop manager must sign) -> completed.
--   audit_report_items  a SNAPSHOT of the items at the time the audit was
--                       created (title/details/file copied in), plus the
--                       auditor's per-item comment and the "Audited" tick —
--                       so editing Settings later never rewrites history.
--
-- Signatures are stored as PNG data URLs (a few KB each) directly on the
-- report row — no storage bucket / policy needed.
--
-- Who can do what (the real boundary; the UI just mirrors it):
--   * admin / developer (is_admin()): manage items, create + edit drafts,
--     submit, delete drafts, read everything.
--   * shop_manager: read non-draft audits for the stores they belong to, and
--     confirm a pending one — only through confirm_audit_report() below, so a
--     manager can never alter the auditor's ticks/comments/signature.

create table audit_items (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  title       text not null,
  content     text,
  file_path   text,          -- file_repository.file_path (documents bucket), copied in
  file_name   text,          -- file_repository.display_name at link time
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_audit_items_store on audit_items(store_id, sort_order);
create trigger trg_audit_items_updated_at before update on audit_items
  for each row execute function set_updated_at();

create table audit_reports (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references stores(id) on delete cascade,
  audit_date         date not null,
  status             text not null default 'draft'
                       check (status in ('draft', 'pending_confirmation', 'completed')),
  meeting_summary    text,
  auditor_name       text,
  auditor_signature  text,
  created_by         uuid references profiles(id) on delete set null,
  submitted_at       timestamptz,
  confirmed_by       uuid references profiles(id) on delete set null,
  confirmed_by_name  text,
  manager_signature  text,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_audit_reports_store on audit_reports(store_id, status, audit_date desc);
create trigger trg_audit_reports_updated_at before update on audit_reports
  for each row execute function set_updated_at();

create table audit_report_items (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references audit_reports(id) on delete cascade,
  title       text not null,
  content     text,
  file_path   text,
  file_name   text,
  comment     text,                         -- "Auditor's comment" for this row
  audited     boolean not null default false,
  sort_order  int not null default 0
);
create index idx_audit_report_items_report on audit_report_items(report_id, sort_order);

alter table audit_items enable row level security;
alter table audit_reports enable row level security;
alter table audit_report_items enable row level security;

-- ---- audit_items (Settings) -----------------------------------------------
create policy "read audit_items" on audit_items
  for select using (is_manager_or_admin() and (store_id = any (current_store_ids()) or is_admin()));
create policy "admin insert audit_items" on audit_items
  for insert with check (is_admin());
create policy "admin update audit_items" on audit_items
  for update using (is_admin()) with check (is_admin());
create policy "admin delete audit_items" on audit_items
  for delete using (is_admin());

-- ---- audit_reports --------------------------------------------------------
-- Drafts are the admin's private work in progress: a shop manager only ever
-- sees an audit once it has been submitted.
create policy "read audit_reports" on audit_reports
  for select using (
    is_manager_or_admin()
    and (store_id = any (current_store_ids()) or is_admin())
    and (status <> 'draft' or is_admin())
  );
create policy "admin insert audit_reports" on audit_reports
  for insert with check (is_admin() and status in ('draft', 'pending_confirmation'));
-- A submitted/completed audit is locked: admin can only edit while it's a
-- draft (and may move it draft -> pending_confirmation, never straight to
-- completed — only confirm_audit_report() does that).
create policy "admin update draft audit_reports" on audit_reports
  for update using (is_admin() and status = 'draft')
  with check (is_admin() and status in ('draft', 'pending_confirmation'));
create policy "admin delete draft audit_reports" on audit_reports
  for delete using (is_admin() and status = 'draft');

-- ---- audit_report_items ---------------------------------------------------
-- The sub-select on audit_reports runs under the caller's own RLS, so this
-- inherits the draft/store visibility rules above.
create policy "read audit_report_items" on audit_report_items
  for select using (exists (select 1 from audit_reports r where r.id = audit_report_items.report_id));
create policy "admin insert audit_report_items" on audit_report_items
  for insert with check (
    is_admin() and exists (select 1 from audit_reports r where r.id = audit_report_items.report_id and r.status = 'draft')
  );
create policy "admin update audit_report_items" on audit_report_items
  for update using (
    is_admin() and exists (select 1 from audit_reports r where r.id = audit_report_items.report_id and r.status = 'draft')
  ) with check (
    is_admin() and exists (select 1 from audit_reports r where r.id = audit_report_items.report_id and r.status = 'draft')
  );
create policy "admin delete audit_report_items" on audit_report_items
  for delete using (
    is_admin() and exists (select 1 from audit_reports r where r.id = audit_report_items.report_id and r.status = 'draft')
  );

-- ---- manager confirmation -------------------------------------------------
create or replace function confirm_audit_report(p_report_id uuid, p_signature text, p_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_report audit_reports;
  v_name text;
begin
  if current_role_key() <> 'shop_manager' then
    raise exception 'Only a shop manager can confirm an audit';
  end if;

  select * into v_report from audit_reports where id = p_report_id for update;
  if not found then
    raise exception 'Audit not found';
  end if;
  if not (v_report.store_id = any (current_store_ids())) then
    raise exception 'This audit belongs to a store you do not manage';
  end if;
  if v_report.status <> 'pending_confirmation' then
    raise exception 'This audit is not awaiting confirmation';
  end if;
  if p_signature is null or length(p_signature) = 0 then
    raise exception 'A signature is required';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then
    select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
      into v_name from profiles where id = auth.uid();
  end if;

  update audit_reports
  set status = 'completed',
      confirmed_by = auth.uid(),
      confirmed_by_name = coalesce(v_name, 'Shop Manager'),
      manager_signature = p_signature,
      confirmed_at = now()
  where id = p_report_id;
end;
$$;

revoke all on function confirm_audit_report(uuid, text, text) from public;
grant execute on function confirm_audit_report(uuid, text, text) to authenticated;
