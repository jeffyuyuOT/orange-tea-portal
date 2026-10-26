-- Jeff, 2026-10-26: "item可以同時選擇log跟manager's log，這樣在兩邊都會同時出現，
-- 資料也會互通" — an item's log_type can now also be 'both': it appears in the
-- general Log AND the Manager's Log, backed by the same item row and the same
-- recorded dates, so a date recorded on one side shows on the other.
--
-- Only 'manager' items stay hidden from staff; 'general' and 'both' are
-- visible to everyone at the store (the policies below test log_type <> 'manager').
alter table maintenance_items drop constraint if exists maintenance_items_log_type_check;
alter table maintenance_items
  add constraint maintenance_items_log_type_check check (log_type in ('general', 'manager', 'both'));

drop policy if exists "read maintenance_items" on maintenance_items;
create policy "read maintenance_items" on maintenance_items
  for select using (
    (store_id = any (current_store_ids()) or is_admin())
    and (log_type <> 'manager' or is_admin() or current_role_key() = 'shop_manager')
  );

drop policy if exists "read maintenance_logs" on maintenance_logs;
create policy "read maintenance_logs" on maintenance_logs
  for select using (
    (store_id = any (current_store_ids()) or is_admin())
    and (
      is_admin() or current_role_key() = 'shop_manager'
      or exists (select 1 from maintenance_items i where i.id = maintenance_logs.item_id and i.log_type <> 'manager')
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
        and (i.log_type <> 'manager' or is_admin() or current_role_key() = 'shop_manager')
    )
  );
