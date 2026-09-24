-- Lets a Shop Training Database item carry one or more downloadable file
-- attachments (a checklist PDF, a reference sheet, etc.) alongside its rich
-- text content — same idea as formula_item_videos (0019): a list of child
-- rows rather than squeezing multiple files into a single column, and the
-- file itself lives in the existing 'documents' storage bucket (same one
-- File Repository and My Information's forms already use), this table just
-- links a storage path to the training item plus the label shown to staff.
create table if not exists shop_training_item_files (
  id                     uuid primary key default gen_random_uuid(),
  shop_training_item_id  uuid not null references shop_training_items(id) on delete cascade,
  display_name           text not null,
  file_path              text not null,
  sort_order             int not null default 0,
  uploaded_by            uuid references profiles(id),
  created_at             timestamptz not null default now()
);

create index if not exists shop_training_item_files_item_idx on shop_training_item_files(shop_training_item_id);

alter table shop_training_item_files enable row level security;

create policy "read shop_training_item_files" on shop_training_item_files for select using (auth.role() = 'authenticated');
create policy "admin write shop_training_item_files" on shop_training_item_files for all using (is_admin()) with check (is_admin());
