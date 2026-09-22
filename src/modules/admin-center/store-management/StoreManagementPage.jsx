import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { STAFF_DOC_TYPES } from '../../../lib/staffDocumentTypes'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'

// Add / edit / activate-deactivate stores. `stores` is shared reference
// data — Roster Hub, Bulletin Board, Formula/Quiz visibility and staff
// assignment all key off it — so it's managed in-app the same way Formula
// Database and Quiz Bank manage their own reference data, rather than
// requiring direct Supabase access.
//
// Deliberately no hard-delete button: nearly every table that references
// store_id does so with `on delete cascade` (roster_periods, leave_requests,
// announcements, quiz_question_stores, formula_item_stores, ...), so
// deleting a store here could silently wipe that store's entire roster/
// leave/announcement history. Deactivating (is_active = false) is the safe
// equivalent — it hides the store from pickers/assignment (see
// AuthContext.jsx / StoreSwitcher.jsx) without touching its history.
export default function StoreManagementPage() {
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null closed, {} = new, store = edit
  const [form, setForm] = useState({ name: '', code: '', is_active: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Every File Repository file (grouped by category for the picker below)
  // and this store's current document-type picks — see store_document_links
  // (0025). A file doesn't have to be tagged with any particular category
  // to be linked — Super/Parent Consent forms are often filed under
  // whatever category was selected at upload time — so the picker isn't
  // restricted by category at all, just grouped by one for easier
  // browsing. Which File Repository category exists has no bearing on
  // these three document-type slots (see staffDocumentTypes.js) — a
  // category can be freely renamed or deleted without affecting them. Only
  // relevant once a store already exists, since the link table needs a
  // real store_id.
  const [categories, setCategories] = useState([]) // file_repository_categories, for grouping
  const [allFiles, setAllFiles] = useState([]) // every file_repository row
  const [docLinks, setDocLinks] = useState({}) // { [docTypeKey]: { fileId, url } }
  // Which store's Activate/Deactivate button is mid-request — locks just
  // that one button so a slow connection can't fire the toggle twice.
  const [toggleBusyId, setToggleBusyId] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('stores').select('*').order('name')
    setStores(data ?? [])
    setLoading(false)
  }
  async function loadFileOptions() {
    const [catRes, fileRes] = await Promise.all([
      supabase.from('file_repository_categories').select('*').order('sort_order'),
      supabase.from('file_repository').select('id, category_id, display_name').order('display_name'),
    ])
    setCategories(catRes.data ?? [])
    setAllFiles(fileRes.data ?? [])
  }
  useEffect(() => {
    load()
    loadFileOptions()
  }, [])

  function openNew() {
    setForm({ name: '', code: '', is_active: true })
    setDocLinks({})
    setError('')
    setEditing({})
  }

  async function openEdit(store) {
    setForm({ name: store.name, code: store.code, is_active: store.is_active })
    setError('')
    setEditing(store)
    const { data } = await supabase
      .from('store_document_links')
      .select('doc_type, file_repository_id, url')
      .eq('store_id', store.id)
    const links = {}
    ;(data ?? []).forEach((l) => (links[l.doc_type] = { fileId: l.file_repository_id ?? '', url: l.url ?? '' }))
    setDocLinks(links)
  }

  async function save() {
    if (!form.name.trim() || !form.code.trim()) {
      setError('Name and code are both required.')
      return
    }
    setSaving(true)
    setError('')
    const payload = { name: form.name.trim(), code: form.code.trim(), is_active: form.is_active }
    const { data: savedStore, error: err } = editing.id
      ? await supabase.from('stores').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('stores').insert(payload).select().single()
    if (err) {
      setSaving(false)
      setError(err.message)
      return
    }
    // Apply each document type's pick (or removal) against store_document_links.
    // A pasted link (if present) wins over a File Repository file pick —
    // the two inputs are kept mutually exclusive in the UI already.
    const linkResults = await Promise.all(
      STAFF_DOC_TYPES.map(({ key: docType }) => {
        const { fileId, url } = docLinks[docType] ?? {}
        const trimmedUrl = url?.trim()
        if (trimmedUrl) {
          return supabase
            .from('store_document_links')
            .upsert(
              { store_id: savedStore.id, doc_type: docType, file_repository_id: null, url: trimmedUrl },
              { onConflict: 'store_id,doc_type' }
            )
        }
        if (fileId) {
          return supabase
            .from('store_document_links')
            .upsert(
              { store_id: savedStore.id, doc_type: docType, file_repository_id: fileId, url: null },
              { onConflict: 'store_id,doc_type' }
            )
        }
        return supabase.from('store_document_links').delete().eq('store_id', savedStore.id).eq('doc_type', docType)
      })
    )
    setSaving(false)
    const linkErr = linkResults.find((r) => r.error)?.error
    if (linkErr) {
      setError(linkErr.message)
      return
    }
    setEditing(null)
    load()
  }

  async function toggleActive(store) {
    setToggleBusyId(store.id)
    await supabase.from('stores').update({ is_active: !store.is_active }).eq('id', store.id)
    await load()
    setToggleBusyId(null)
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Store Management</h1>
      <p className="mb-4 text-sm text-gray-500">
        Stores used across Roster Hub, Bulletin Board, Formula/Quiz visibility and staff assignment. Deactivate a
        store instead of deleting it (deleting isn't offered here — it would cascade-delete that store's rosters,
        leave records and announcements).
      </p>

      <div className="mb-3 flex justify-end">
        <Button onClick={openNew}>+ New store</Button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !stores.length ? (
        <EmptyState label="No stores yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {stores.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
              <button onClick={() => openEdit(s)} className="flex-1 text-left">
                <div className="text-sm font-medium text-gray-800">{s.name}</div>
                <div className="text-xs text-gray-400">{s.code}</div>
              </button>
              <div className="flex items-center gap-3">
                <Badge color={s.is_active ? 'green' : 'gray'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                <button
                  onClick={() => toggleActive(s)}
                  disabled={toggleBusyId === s.id}
                  className="text-xs font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {s.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit store' : 'New store'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Store name</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Code (short, unique — e.g. MEL01)</span>
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Active
          </label>

          {editing?.id && (
            <div className="border-t border-brand-100 pt-3">
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Document links — which file this store's staff download from My Information
              </span>
              <div className="space-y-3">
                {STAFF_DOC_TYPES.map((d) => {
                  const link = docLinks[d.key] ?? { fileId: '', url: '' }
                  return (
                    <div key={d.key} className="rounded-lg border border-brand-100 p-2.5">
                      <span className="mb-1 block text-xs font-medium text-gray-600">{d.label}</span>
                      <select
                        className="input mb-1.5"
                        value={link.fileId}
                        onChange={(e) => setDocLinks({ ...docLinks, [d.key]: { fileId: e.target.value, url: '' } })}
                      >
                        <option value="">— Pick a File Repository file —</option>
                        {categories.map((c) => {
                          const filesInCategory = allFiles.filter((f) => f.category_id === c.id)
                          if (!filesInCategory.length) return null
                          return (
                            <optgroup key={c.id} label={c.label}>
                              {filesInCategory.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.display_name}
                                </option>
                              ))}
                            </optgroup>
                          )
                        })}
                      </select>
                      <input
                        className="input"
                        placeholder="…or paste a link directly (e.g. Google Drive)"
                        value={link.url}
                        onChange={(e) => setDocLinks({ ...docLinks, [d.key]: { fileId: '', url: e.target.value } })}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </Modal>
    </div>
  )
}
