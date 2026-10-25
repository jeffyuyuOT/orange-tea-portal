create table if not exists shop_training_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table shop_training_categories enable row level security;

create policy "read shop_training_categories" on shop_training_categories
  for select using (store_id = any (current_store_ids()) or is_admin());

create policy "manager admin write shop_training_categories" on shop_training_categories
  for all
  using ((is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin())
  with check ((is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin());

create index if not exists shop_training_categories_store_id_idx on shop_training_categories (store_id);

alter table shop_training_items
  add column if not exists category_id uuid null references shop_training_categories(id) on delete set null;

create index if not exists shop_training_items_category_id_idx on shop_training_items (category_id) where category_id is not null;
