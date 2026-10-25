alter table shop_training_categories add column if not exists copy_group_id uuid null;
create index if not exists shop_training_categories_copy_group_id_idx on shop_training_categories (copy_group_id) where copy_group_id is not null;
