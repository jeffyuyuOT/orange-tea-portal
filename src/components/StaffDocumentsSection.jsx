import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { STAFF_DOC_TYPES } from '../lib/staffDocumentTypes'

// TFN declaration / Super Choice / Parent-Guardian Consent uploads — shown
// on both My Information (the staff member's own view) and Staff
// Information (a manager/accountant's view of someone else), per Jeff:
// "My information的這些資訊要和staff information相通，包含上傳的TFN, super
// for和parent consent form" — both pages read/write the exact same
// `user_documents` rows (keyed by profile_id + doc_type, same as always),
// this component is just the one UI both render it with so they can never
// drift apart. `ownView` = My Information (the person's own page: shows the upload
// hint only; Staff Information also shows when each file will be removed). `readOnly` (Staff Information's accountant viewers, who are
// view-only everywhere on that page) hides the Upload control — the
// uploaded file and the blank-template link still show.
// Jeff, 2026-10-29: uploads are kept for 30 days only — a daily job (migration 0139,
// cleanup_expired_user_documents) deletes the file and the user_documents row after that.
const RETENTION_DAYS = 30

// "November 12" — the last day the file is kept, in Brisbane time.
function retainedUntil(uploadedAt) {
  const d = new Date(new Date(uploadedAt).getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-AU', { month: 'long', day: 'numeric', timeZone: 'Australia/Brisbane' })
    .format(d)
    .split(' ')
    .reverse()
    .join(' ')
}

export default function StaffDocumentsSection({ profileId, storeId, readOnly = false, ownView = false, title = 'Documents' }) {
  const [docs, setDocs] = useState({})
  const [templates, setTemplates] = useState({})

  useEffect(() => {
    if (!profileId) return
    supabase
      .from('user_documents')
      .select('*')
      .eq('profile_id', profileId)
      .order('uploaded_at') // the newest upload of a type wins
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((d) => (map[d.doc_type] = d))
        setDocs(map)
      })
  }, [profileId])

  // Which blank template file to offer depends on the staff's store — set
  // per store in Store Management (store_document_links). No store
  // selected, or that store has no file linked for a category, just means
  // no "Download blank form" link shows for it.
  useEffect(() => {
    if (!storeId) {
      setTemplates({})
      return
    }
    supabase
      .from('store_document_links')
      .select('doc_type, url, file_repository(file_path)')
      .eq('store_id', storeId)
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((l) => {
          const href = l.url || (l.file_repository ? supabase.storage.from('documents').getPublicUrl(l.file_repository.file_path).data.publicUrl : null)
          if (href) map[l.doc_type] = href
        })
        setTemplates(map)
      })
  }, [storeId])

  async function uploadDoc(docType, file) {
    const path = `user-documents/${profileId}/${docType}-${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (error) {
      alert(`Upload failed: ${error.message}`)
      return
    }
    const { data } = await supabase
      .from('user_documents')
      .insert({ profile_id: profileId, doc_type: docType, file_path: path, original_name: file.name })
      .select()
      .single()
    setDocs((prev) => ({ ...prev, [docType]: data }))
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-brand-700">{title}</h2>
      {!readOnly && <p className="mb-3 text-xs text-gray-500">Uploaded files are retained for 30 days only.</p>}
      {readOnly && <div className="mb-3" />}
      <div className="space-y-3">
        {STAFF_DOC_TYPES.map((d) => {
          const uploaded = docs[d.key]
          // Same bucket templates already use getPublicUrl on — this is
          // what actually lets a viewer OPEN the uploaded file (previously
          // My Information only ever said "Uploaded: <name>" as plain
          // text with nothing to click, which was fine when the only
          // reader was the person who'd just uploaded it, but not once a
          // manager/accountant is looking at it from Staff Information).
          const uploadedHref = uploaded ? supabase.storage.from('documents').getPublicUrl(uploaded.file_path).data.publicUrl : null
          return (
            <div key={d.key} className="flex items-center justify-between rounded-lg border border-brand-100 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-gray-800">{d.label}</div>
                <div className="text-xs text-gray-400">
                  {uploaded ? (
                    <a className="text-brand-600 hover:underline" href={uploadedHref} target="_blank" rel="noreferrer">
                      {uploaded.original_name}
                    </a>
                  ) : (
                    'Not uploaded yet'
                  )}
                  {templates[d.key] && (
                    <>
                      {' · '}
                      <a className="text-brand-600 hover:underline" href={templates[d.key]} target="_blank" rel="noreferrer">
                        Download blank form
                      </a>
                    </>
                  )}
                </div>
                {uploaded && !ownView && (
                  <div className="mt-0.5 text-xs text-amber-600">
                    This file will only be retained until {retainedUntil(uploaded.uploaded_at)}. Please download it if you need a backup.
                  </div>
                )}
              </div>
              {!readOnly && (
                <label className="cursor-pointer rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
                  Upload
                  <input type="file" className="hidden" onChange={(e) => e.target.files[0] && uploadDoc(d.key, e.target.files[0])} />
                </label>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
