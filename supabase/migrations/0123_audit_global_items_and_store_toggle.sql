-- Jeff, 2026-10-18 (follow-up to 0122_audit.sql):
--   1. Audit Settings is ONE form shared by every store, not one per store.
--   2. Audit is switched on per store in Store Management (stores.audit_enabled).
--      A store with it off has no Audit tab for its shop managers and doesn't
--      appear in Audit's store switcher.
--
-- Run 0122 first, then this.

-- ---- 2. per-store switch --------------------------------------------------
alter table stores add column if not exists audit_enabled boolean not null default false;

-- ---- 1. audit_items becomes global ----------------------------------------
drop policy if exists "read audit_items" on audit_items;
drop policy if exists "admin insert audit_items" on audit_items;
drop policy if exists "admin update audit_items" on audit_items;
drop policy if exists "admin delete audit_items" on audit_items;

-- If items were already entered per store while testing, keep only the first
-- store's list (a no-op when the table is empty or already single-store).
delete from audit_items
where store_id is distinct from (select store_id from audit_items order by created_at, id limit 1);

drop index if exists idx_audit_items_store;
alter table audit_items drop column if exists store_id;
create index if not exists idx_audit_items_sort on audit_items(sort_order);

create policy "read audit_items" on audit_items
  for select using (is_manager_or_admin());
create policy "admin insert audit_items" on audit_items
  for insert with check (is_admin());
create policy "admin update audit_items" on audit_items
  for update using (is_admin()) with check (is_admin());
create policy "admin delete audit_items" on audit_items
  for delete using (is_admin());

-- ---- reports: shop managers only see audits of stores with Audit on --------
-- Admin/developer still read every store's audits (so history survives a
-- store being switched off later).
drop policy if exists "read audit_reports" on audit_reports;
create policy "read audit_reports" on audit_reports
  for select using (
    is_admin()
    or (
      current_role_key() = 'shop_manager'
      and status <> 'draft'
      and store_id = any (current_store_ids())
      and exists (select 1 from stores s where s.id = audit_reports.store_id and s.audit_enabled)
    )
  );

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
  if not exists (select 1 from stores s where s.id = v_report.store_id and s.audit_enabled) then
    raise exception 'Audit is not switched on for this store';
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
