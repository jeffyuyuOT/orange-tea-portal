-- Store Management's per-store document picker only offered files whose
-- File Repository category exactly matched the document type (TFN files
-- for the TFN slot, etc). In practice a blank Super/Parent Consent form
-- may have been uploaded under a different category (or none), so the
-- picker showed nothing to choose — this migration removes that
-- restriction at the schema level; the picker itself now lists every
-- File Repository file grouped by category, and can alternatively store a
-- pasted-in link with no File Repository file at all (e.g. a Google Drive
-- link), matching how Formula Database's video links already work.
alter table store_document_links alter column file_repository_id drop not null;
alter table store_document_links add column if not exists url text;

alter table store_document_links drop constraint if exists store_document_links_source_check;
alter table store_document_links
  add constraint store_document_links_source_check
  check (file_repository_id is not null or url is not null);
