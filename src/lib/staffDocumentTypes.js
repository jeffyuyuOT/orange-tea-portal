// The document types My Information offers a "download blank form" link
// for, and that Store Management lets admins link a per-store file (or
// pasted-in URL) to (see store_document_links, migration 0025). Shared
// between the two pages so they can never drift apart.
//
// `key` is this slot's own fixed, permanent identifier — deliberately NOT
// tied to any File Repository category, so admins can freely add, rename
// or delete categories (see FileCategoryManager) without ever affecting
// these three document-download slots.
export const STAFF_DOC_TYPES = [
  { key: 'tfn', label: 'Tax File Number (TFN) Declaration' },
  { key: 'super', label: 'Super Choice Form' },
  { key: 'parent_consent', label: 'Parent / Guardian Consent Form' },
]
