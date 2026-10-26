-- Jeff, 2026-10-26: "新增manager's log分頁在一般log跟setting中間，setting裡的item
-- 現在要選擇是在log還是manager's log...只有shop manager, admin, developer可以看到
-- manager's log".
--
-- Each maintenance item now belongs to either the general Log ('general') or
-- the Manager's Log ('manager'). Manager items (and the dates recorded
-- against them) are hidden at the data layer from everyone except shop
-- managers (of that store), admin and developer — not just from the menu.
alter table maintenance_items
  add column if not exists log_type text not null default 'general'
  check (log_type in ('general', 'manager'));

drop policy if exists "read maintenance_items" on maintenance_items;
create policy "read maintenance_items" on maintenance_items
  for select using (
    (store_id = any (current_store_ids()) or is_admin())
    and (log_type = 'general' or is_admin() or current_role_key() = 'shop_manager')
  );

drop policy if exists "read maintenance_logs" on maintenance_logs;
create policy "read maintenance_logs" on maintenance_logs
  for select using (
    (store_id = any (current_store_ids()) or is_admin())
    and (
      is_admin() or current_role_key() = 'shop_manager'
      or exists (select 1 from maintenance_items i where i.id = maintenance_logs.item_id and i.log_type = 'general')
    )
  );

drop policy if exists "insert own maintenance_logs" on maintenance_logs;
create policy "insert own maintenance_logs" on maintenance_logs
  for insert with check (
    done_by = (select auth.uid())
    and (store_id = any (current_store_ids()) or is_admin())
    and exists (
      select 1 from maintenance_items i
      where i.id = maintenance_logs.item_id and i.store_id = maintenance_logs.store_id
        and (i.log_type = 'general' or is_admin() or current_role_key() = 'shop_manager')
    )
  );
