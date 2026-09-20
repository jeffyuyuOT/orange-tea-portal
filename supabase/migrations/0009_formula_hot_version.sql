-- Lets a formula item offer a "Hot" ingredient list as a toggle on the item
-- itself (Formula page: an Iced/Cold vs Hot switch) instead of needing a
-- whole separate item — e.g. "Winter Oolong/MGT/BT" and
-- "Winter Oolong/MGT/BT (Hot)" used to be two items in the category list;
-- now they're one item with has_hot_version = true. Method (steps) stays
-- shared across Hot and Cold, same as it already is across sizes.
alter table formula_items add column if not exists has_hot_version boolean not null default false;
alter table formula_item_ingredients add column if not exists is_hot boolean not null default false;
