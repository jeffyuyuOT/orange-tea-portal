-- Jeff, 2026-10-26: Maintenance Setting items can be copied to other stores
-- by an admin ("Copy to other store"), and the copies stay linked: editing one
-- with "Save to Multiple Stores" updates every linked copy. Same mechanism as
-- shop_training_items.copy_group_id (migration 0135).
alter table maintenance_items add column if not exists copy_group_id uuid;
create index if not exists idx_maintenance_items_copy_group on maintenance_items(copy_group_id) where copy_group_id is not null;
