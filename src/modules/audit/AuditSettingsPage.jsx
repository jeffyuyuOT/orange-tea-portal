import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import FileRepositoryPicker from '../../components/ui/FileRepositoryPicker'
import LoadingSpinner, { EmptyState } from '../../components/ui/LoadingSpinner'
import { auditFileUrl, isAuditAdmin } from './auditUtils'

const EMPTY = { id: null, title: '', content: '', file_path: null, file_name: null }

export default function AuditSettingsPage() {
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const canEdit = isAuditAdmin(profile)
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? ''

  const [items, setItems] = useState(null) // null = loading
  const [form, setForm] = useState(null) // item being added/edited
  const [pickingFile, setPickingFile] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!currentStoreId) return
    const { data, error: err } = await supabase.from('audit_items').select('*').eq('store_id', currentStoreId).order('sort_order')
    if (err) setError(err.message)
    setItems(data ?? [])
  }, [currentStoreId])

  useEffect(() => {
    setItems(null)
    setForm(null)
    setError('')
    load()
  }, [load])

  async function save() {
    if (!form.title.trim()) return
    setError('')
    const fields = {
      title: form.title.trim(),
      content: form.content.trim() || null,
      file_path: form.file_path,
      file_name: form.file_name,
    }
    const { error: err } = form.id
      ? await supabase.from('audit_items').update(fields).eq('id', form.id)
      : await supabase
          .from('audit_items')
          .insert({ ...fields, store_id: currentStoreId, sort_order: items.length ? Math.max(...items.map((i) => i.sort_order)) + 1 : 0 })
    if (err) return setError(err.message)
    setForm(null)
    await load()
  }

  async function remove(item) {
    if (!window.confirm(`Delete "${item.title}"? Past audits keep their own copy of this item.`)) return
    const { error: err } = await supabase.from('audit_items').delete().eq('id', item.id)
    if (err) return setError(err.message)
    await load()
  }

  async function move(index, delta) {
    const a = items[index]
    const b = items[index + delta]
    if (!a || !b) return
    // Rewrite the whole order rather than swapping two values, so items that
    // happen to share a sort_order can never get stuck.
    const next = [...items]
    next[index] = b
    next[index + delta] = a
    setItems(next)
    const results = await Promise.all(next.map((it, i) => supabase.from('audit_items').update({ sort_order: i }).eq('id', it.id)))
    const failed = results.find((r) => r.error)
    if (failed) setError(failed.error.message)
    await load()
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">Audit Settings</h1>
        {canEdit && <Button onClick={() => setForm({ ...EMPTY })}>+ Add item</Button>}
      </div>
      <p className="mb-4 text-sm text-gray-500">
        The items that appear on every new audit for <span className="font-medium text-gray-700">{storeName}</span>. Changes only affect
        audits created afterwards.
      </p>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {items === null ? (
        <LoadingSpinner />
      ) : !items.length ? (
        <EmptyState label="No audit items for this store yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {items.map((it, i) => (
            <div key={it.id} className="flex items-start gap-3 px-4 py-3">
              {canEdit && (
                <div className="flex shrink-0 flex-col text-gray-400">
                  <button disabled={i === 0} onClick={() => move(i, -1)} className="px-1 leading-4 hover:text-brand-600 disabled:opacity-30" aria-label="Move up">
                    ▲
                  </button>
                  <button
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    className="px-1 leading-4 hover:text-brand-600 disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  {it.title}
                  {it.file_path && (
                    <a href={auditFileUrl(it.file_path)} target="_blank" rel="noreferrer" title={it.file_name || 'Open file'} className="hover:opacity-70">
                      📎
                    </a>
                  )}
                </div>
                {it.content && <div className="mt-0.5 whitespace-pre-wrap text-sm text-gray-600">{it.content}</div>}
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" onClick={() => setForm({ ...EMPTY, ...it, content: it.content ?? '' })}>
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => remove(it)}>
                    Delete
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit audit item' : 'Add audit item'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!form?.title.trim()}>
              Save
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Title</label>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Details</label>
              <textarea rows={5} className="input" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Linked file (optional)</label>
              {form.file_path ? (
                <div className="flex items-center gap-2 text-sm">
                  <span>📎</span>
                  <span className="truncate text-gray-700">{form.file_name || form.file_path}</span>
                  <button className="ml-auto text-xs font-medium text-red-600 hover:text-red-800" onClick={() => setForm({ ...form, file_path: null, file_name: null })}>
                    Remove
                  </button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setPickingFile(true)}>
                  + From File Repository
                </Button>
              )}
              <p className="mt-1 text-xs text-gray-400">A 📎 icon shows next to this item on the audit sheet and opens the file.</p>
            </div>
          </div>
        )}
      </Modal>

      {pickingFile && (
        <FileRepositoryPicker
          accept="all"
          onClose={() => setPickingFile(false)}
          onSelect={(f) => {
            setForm((cur) => ({ ...cur, file_path: f.file_path, file_name: f.display_name }))
            setPickingFile(false)
          }}
        />
      )}
    </div>
  )
}
