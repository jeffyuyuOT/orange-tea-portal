-- The three "document type" slots My Information downloads from (TFN /
-- Super / Parent Consent) were identified by a fixed row id in
-- file_repository_categories. That meant those three category rows could
-- never be deleted — even with zero stores currently linked to them —
-- without permanently breaking Store Management's ability to link a file
-- for that slot again (the FK insert would start failing). But File
-- Repository's categories are meant to be freely added/renamed/deleted by
-- admins, so the two concepts are decoupled here: a document-type slot is
-- now identified by its own fixed text id (matches STAFF_DOC_TYPES[].key
-- in src/lib/staffDocumentTypes.js), with no link at all to
-- file_repository_categories. Categories can now be deleted freely.
alter table store_document_links add column if not exists doc_type text;

update store_document_links set doc_type = 'tfn' where category_id = '00000000-0000-0000-0000-000000000001' and doc_type is null;
update store_document_links set doc_type = 'super' where category_id = '00000000-0000-0000-0000-000000000002' and doc_type is null;
update store_document_links set doc_type = 'parent_consent' where category_id = '00000000-0000-0000-0000-000000000003' and doc_type is null;

alter table store_document_links drop constraint if exists store_document_links_category_id_fkey;
alter table store_document_links drop constraint if exists store_document_links_store_id_category_id_key;
alter table store_document_links drop column if exists category_id;

alter table store_document_links alter column doc_type set not null;

alter table store_document_links drop constraint if exists store_document_links_doc_type_check;
alter table store_document_links
  add constraint store_document_links_doc_type_check check (doc_type in ('tfn', 'super', 'parent_consent'));

alter table store_document_links drop constraint if exists store_document_links_store_id_doc_type_key;
alter table store_document_links add constraint store_document_links_store_id_doc_type_key unique (store_id, doc_type);
