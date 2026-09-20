-- 0010 created formula_item_annotations but, unlike every other table in the
-- schema, never enabled Row Level Security or added policies for it. With no
-- RLS policy at all, Supabase's PostgREST layer denies every request against
-- the table by default once RLS is enabled (and some projects auto-enable
-- RLS on new tables) — so inserts/deletes against formula_item_annotations
-- could fail silently, which lines up with "Ingredient table notes can't be
-- saved". This brings it in line with the same read/admin-write pattern used
-- for formula_item_ingredients, formula_item_steps, etc.
alter table formula_item_annotations enable row level security;

create policy "read formula_item_annotations" on formula_item_annotations for select using (auth.role() = 'authenticated');
create policy "admin write formula_item_annotations" on formula_item_annotations for all using (is_admin()) with check (is_admin());
