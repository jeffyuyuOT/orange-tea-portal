-- Optional label used to visually box a set of ingredients together on the
-- Formula page (e.g. "these go in the blender") — ingredients that share
-- the same non-blank group_label, next to each other in sort order, are
-- drawn inside one bordered box together instead of as separate standalone
-- chips/columns. Blank/null = no grouping, drawn as before.
alter table formula_item_ingredients add column if not exists group_label text;

-- Small standalone notes shown just above or below the ingredients
-- table/chips on the Formula page — separate from the big rich-text Notes
-- field below them, for short footnote-style call-outs that don't need a
-- full paragraph and belong right next to the table rather than under
-- everything else.
create table if not exists formula_item_annotations (
  id uuid primary key default gen_random_uuid(),
  formula_item_id uuid not null references formula_items(id) on delete cascade,
  position text not null default 'below' check (position in ('above', 'below')),
  text text not null,
  sort_order int not null default 0
);

create index if not exists formula_item_annotations_item_idx on formula_item_annotations(formula_item_id);
