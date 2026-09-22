-- One formula item can need more than one instructional video (e.g. a
-- blending clip and a separate garnish clip for the same drink), and each
-- one should carry its own short title so staff know which is which. This
-- replaces trying to squeeze that into the single Notes image/video field,
-- which could only ever hold one attachment.
create table if not exists formula_item_videos (
  id uuid primary key default gen_random_uuid(),
  formula_item_id uuid not null references formula_items(id) on delete cascade,
  title text,
  url text not null,
  sort_order int not null default 0
);

create index if not exists formula_item_videos_item_idx on formula_item_videos(formula_item_id);

alter table formula_item_videos enable row level security;

create policy "read formula_item_videos" on formula_item_videos for select using (auth.role() = 'authenticated');
create policy "admin write formula_item_videos" on formula_item_videos for all using (is_admin()) with check (is_admin());
