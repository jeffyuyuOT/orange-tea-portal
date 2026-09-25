-- Per-store visibility for Shop Training content, same shape/convention as
-- formula_item_stores (Formula Database) and quiz_question_stores: an item
-- with NO rows here is visible at every store (matches the Admin UI default
-- of "all stores checked"); an item WITH rows is only visible at the stores
-- listed. See src/lib/storeVisibility.js's filterVisibleForStore().
create table if not exists shop_training_item_stores (
  shop_training_item_id uuid not null references shop_training_items(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  primary key (shop_training_item_id, store_id)
);

alter table shop_training_item_stores enable row level security;

drop policy if exists "admin write shop_training_item_stores" on shop_training_item_stores;
create policy "admin write shop_training_item_stores" on shop_training_item_stores
  for all using (is_admin()) with check (is_admin());

drop policy if exists "read shop_training_item_stores" on shop_training_item_stores;
create policy "read shop_training_item_stores" on shop_training_item_stores
  for select using (auth.role() = 'authenticated');
