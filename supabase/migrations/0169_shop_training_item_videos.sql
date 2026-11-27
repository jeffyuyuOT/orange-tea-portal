-- Jeff, 2026-11-27: a Shop Training Database item can carry titled video links
-- (title + URL), same idea as formula_item_videos (0019). Child rows of
-- shop_training_items, with the same per-store RLS as shop_training_item_files (0052).
create table if not exists shop_training_item_videos (
  id                     uuid primary key default gen_random_uuid(),
  shop_training_item_id  uuid not null references shop_training_items(id) on delete cascade,
  title                  text,
  url                    text not null,
  sort_order             int not null default 0,
  created_at             timestamptz not null default now()
);

create index if not exists shop_training_item_videos_item_idx on shop_training_item_videos(shop_training_item_id);

alter table shop_training_item_videos enable row level security;

drop policy if exists "read shop_training_item_videos" on shop_training_item_videos;
create policy "read shop_training_item_videos" on shop_training_item_videos
  for select using (
    exists (
      select 1 from shop_training_items i
      where i.id = shop_training_item_videos.shop_training_item_id
        and (i.store_id = any (current_store_ids()) or is_admin())
    )
  );

drop policy if exists "manager admin write shop_training_item_videos" on shop_training_item_videos;
create policy "manager admin write shop_training_item_videos" on shop_training_item_videos
  for all
  using (
    exists (
      select 1 from shop_training_items i
      where i.id = shop_training_item_videos.shop_training_item_id
        and ((is_manager_or_admin() and i.store_id = any (current_store_ids())) or is_admin())
    )
  )
  with check (
    exists (
      select 1 from shop_training_items i
      where i.id = shop_training_item_videos.shop_training_item_id
        and ((is_manager_or_admin() and i.store_id = any (current_store_ids())) or is_admin())
    )
  );
