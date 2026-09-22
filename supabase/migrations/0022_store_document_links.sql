-- My Information's blank-template downloads (TFN / Super / Parent Consent)
-- used to look up a File Repository file by category alone, which only
-- works if every store shares one file per category. Some documents differ
-- per store (e.g. a state-specific form), so this lets Store Management
-- point each store at its own File Repository file for each document type.
--
-- One row per (store, category) — at most one linked file per store per
-- document type. `category_id` is one of the three fixed ids seeded in
-- 0020 that src/lib/staffDocumentTypes.js also hardcodes.
create table if not exists store_document_links (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references stores(id) on delete cascade,
  category_id         uuid not null references file_repository_categories(id) on delete cascade,
  file_repository_id  uuid not null references file_repository(id) on delete cascade,
  unique (store_id, category_id)
);

alter table store_document_links enable row level security;

drop policy if exists "read store_document_links" on store_document_links;
create policy "read store_document_links" on store_document_links for select using (auth.role() = 'authenticated');

drop policy if exists "admin write store_document_links" on store_document_links;
create policy "admin write store_document_links" on store_document_links for all using (is_admin()) with check (is_admin());
