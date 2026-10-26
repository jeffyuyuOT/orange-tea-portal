-- Jeff, 2026-10-26: "在operation & training下新增Maintenance log" — a per-store
-- Shop Maintenance Schedule (pest control, filter changes, ice machine
-- cleaning, ...).
--
--   maintenance_items  the services a store tracks: name, how often
--                      (frequency_months, 1 = Monthly), optional category
--                      (same-named categories are shown grouped) and a
--                      sort_order (drag to reorder in Setting).
--   maintenance_logs   one row each time someone records a service as done:
--                      the date it was done and who recorded it
--                      (done_by_name is a permanent text snapshot so the
--                      table still shows who did it after an account is
--                      removed).
--
-- Items are per store (a store's shop manager owns their list, like Branch
-- Quiz Bank / Shop Training Database). Everyone at the store can read the
-- items and record a service; only shop managers of that store and admin/
-- developer can add/edit/delete/reorder items. A logged date can be changed
-- or removed by whoever recorded it, or by a shop manager of that store /
-- admin / developer.

create table maintenance_items (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references stores(id) on delete cascade,
  name              text not null,
  frequency_months  int not null check (frequency_months between 1 and 120),
  category          text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_maintenance_items_store on maintenance_items(store_id, sort_order);
create trigger trg_maintenance_items_updated_at before update on maintenance_items
  for each row execute function set_updated_at();

create table maintenance_logs (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references stores(id) on delete cascade,
  item_id        uuid not null references maintenance_items(id) on delete cascade,
  done_date      date not null,
  done_by        uuid references profiles(id) on delete set null,
  done_by_name   text not null,
  created_at     timestamptz not null default now()
);
create index idx_maintenance_logs_store_date on maintenance_logs(store_id, done_date);
create index idx_maintenance_logs_item_date on maintenance_logs(item_id, done_date);

alter table maintenance_items enable row level security;
alter table maintenance_logs enable row level security;

-- ---- items ----------------------------------------------------------------
create policy "read maintenance_items" on maintenance_items
  for select using (store_id = any (current_store_ids()) or is_admin());

create policy "manager admin insert maintenance_items" on maintenance_items
  for insert with check (
    is_admin() or (current_role_key() = 'shop_manager' and store_id = any (current_store_ids()))
  );
create policy "manager admin update maintenance_items" on maintenance_items
  for update
  using (is_admin() or (current_role_key() = 'shop_manager' and store_id = any (current_store_ids())))
  with check (is_admin() or (current_role_key() = 'shop_manager' and store_id = any (current_store_ids())));
create policy "manager admin delete maintenance_items" on maintenance_items
  for delete using (
    is_admin() or (current_role_key() = 'shop_manager' and store_id = any (current_store_ids()))
  );

-- ---- logs -----------------------------------------------------------------
create policy "read maintenance_logs" on maintenance_logs
  for select using (store_id = any (current_store_ids()) or is_admin());

-- Record a service: as yourself, at a store you belong to, for an item of
-- that same store.
create policy "insert own maintenance_logs" on maintenance_logs
  for insert with check (
    done_by = (select auth.uid())
    and (store_id = any (current_store_ids()) or is_admin())
    and exists (select 1 from maintenance_items i where i.id = maintenance_logs.item_id and i.store_id = maintenance_logs.store_id)
  );

create policy "update maintenance_logs" on maintenance_logs
  for update
  using (
    done_by = (select auth.uid())
    or is_admin()
    or (current_role_key() = 'shop_manager' and store_id = any (current_store_ids()))
  )
  with check (
    done_by = (select auth.uid())
    or is_admin()
    or (current_role_key() = 'shop_manager' and store_id = any (current_store_ids()))
  );

create policy "delete maintenance_logs" on maintenance_logs
  for delete using (
    done_by = (select auth.uid())
    or is_admin()
    or (current_role_key() = 'shop_manager' and store_id = any (current_store_ids()))
  );
