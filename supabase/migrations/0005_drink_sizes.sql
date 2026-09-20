-- Lets Drink-group formula items offer multiple sizes (e.g. M / L), each
-- with its own ingredient list/quantities. Method (steps) stays shared
-- across all sizes of an item, per product decision.

create table drink_sizes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,        -- e.g. "M", "L", "XL"
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Which sizes a given (drink) formula item offers. No rows for an item
-- means "doesn't use sizes" — a single default formula, exactly today's
-- behaviour — so every existing item keeps working with zero data changes.
create table formula_item_sizes (
  formula_item_id  uuid not null references formula_items(id) on delete cascade,
  size_id          uuid not null references drink_sizes(id) on delete cascade,
  primary key (formula_item_id, size_id)
);

-- Tags each ingredient row to the size it belongs to. Null = the item
-- doesn't use sizes (its one and only ingredient list), matching every
-- ingredient row that already exists today.
alter table formula_item_ingredients
  add column if not exists size_id uuid references drink_sizes(id) on delete cascade;

alter table drink_sizes enable row level security;
alter table formula_item_sizes enable row level security;

create policy "read drink_sizes" on drink_sizes for select using (auth.role() = 'authenticated');
create policy "admin write drink_sizes" on drink_sizes for all using (is_admin()) with check (is_admin());

create policy "read formula_item_sizes" on formula_item_sizes for select using (auth.role() = 'authenticated');
create policy "admin write formula_item_sizes" on formula_item_sizes for all using (is_admin()) with check (is_admin());
