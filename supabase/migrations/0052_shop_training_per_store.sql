-- Splits shop_training_items from a single global list into one row per
-- store, so each store's manager owns and edits their own store's training
-- content (previously only admins could edit this at all, and it was one
-- shared list shown at every store). Existing items are backfilled into
-- every store they were already visible at (all active stores if
-- unrestricted, or the stores in shop_training_item_stores if restricted),
-- keeping the original row/id for one arbitrarily-picked store (so the
-- existing quiz_questions.shop_training_item_id FK stays valid) and
-- inserting fresh duplicate rows (+ copied file attachments) for every
-- other target store. shop_training_item_stores is then dropped — a
-- visibility restriction list no longer means anything once content is
-- store-owned outright.

create temporary table item_targets as
select i.id as item_id, s.id as store_id
from shop_training_items i
join shop_training_item_stores its on its.shop_training_item_id = i.id
join stores s on s.id = its.store_id
union
select i.id as item_id, s.id as store_id
from shop_training_items i
cross join stores s
where s.is_active
  and not exists (select 1 from shop_training_item_stores its2 where its2.shop_training_item_id = i.id);

create temporary table keep_choice as
select distinct on (item_id) item_id, store_id as keep_store_id
from item_targets
order by item_id, store_id;

alter table shop_training_items add column if not exists store_id uuid references stores(id) on delete cascade;

update shop_training_items i
set store_id = k.keep_store_id
from keep_choice k
where k.item_id = i.id;

create temporary table new_item_map as
select t.item_id as source_item_id, t.store_id as target_store_id, gen_random_uuid() as new_item_id
from item_targets t
join keep_choice k on k.item_id = t.item_id
where t.store_id <> k.keep_store_id;

insert into shop_training_items
  (id, title, content_html, sort_order, visible_to_training, created_by, created_by_name, updated_by, updated_by_name, store_id)
select m.new_item_id, i.title, i.content_html, i.sort_order, i.visible_to_training, i.created_by, i.created_by_name, i.updated_by, i.updated_by_name, m.target_store_id
from new_item_map m
join shop_training_items i on i.id = m.source_item_id;

insert into shop_training_item_files (shop_training_item_id, display_name, file_path, sort_order, uploaded_by, created_at)
select m.new_item_id, f.display_name, f.file_path, f.sort_order, f.uploaded_by, f.created_at
from new_item_map m
join shop_training_item_files f on f.shop_training_item_id = m.source_item_id;

drop table item_targets;
drop table keep_choice;
drop table new_item_map;

alter table shop_training_items alter column store_id set not null;
create index if not exists idx_shop_training_items_store_id on shop_training_items(store_id);

drop table if exists shop_training_item_stores;

-- RLS: same store-scoped pattern as roster_entries/leave_requests/training_codes.
drop policy if exists "admin write shop_training_items" on shop_training_items;
drop policy if exists "read shop_training_items" on shop_training_items;

create policy "read shop_training_items" on shop_training_items
  for select using (store_id = any (current_store_ids()) or is_admin());

create policy "manager admin write shop_training_items" on shop_training_items
  for all
  using ((is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin())
  with check ((is_manager_or_admin() and store_id = any (current_store_ids())) or is_admin());

drop policy if exists "admin write shop_training_item_files" on shop_training_item_files;
drop policy if exists "read shop_training_item_files" on shop_training_item_files;

create policy "read shop_training_item_files" on shop_training_item_files
  for select using (
    exists (
      select 1 from shop_training_items i
      where i.id = shop_training_item_files.shop_training_item_id
        and (i.store_id = any (current_store_ids()) or is_admin())
    )
  );

create policy "manager admin write shop_training_item_files" on shop_training_item_files
  for all
  using (
    exists (
      select 1 from shop_training_items i
      where i.id = shop_training_item_files.shop_training_item_id
        and ((is_manager_or_admin() and i.store_id = any (current_store_ids())) or is_admin())
    )
  )
  with check (
    exists (
      select 1 from shop_training_items i
      where i.id = shop_training_item_files.shop_training_item_id
        and ((is_manager_or_admin() and i.store_id = any (current_store_ids())) or is_admin())
    )
  );
