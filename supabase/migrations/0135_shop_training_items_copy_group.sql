alter table shop_training_items add column if not exists copy_group_id uuid null;
create index if not exists shop_training_items_copy_group_id_idx on shop_training_items (copy_group_id) where copy_group_id is not null;
