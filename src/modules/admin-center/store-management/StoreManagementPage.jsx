import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
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

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('stores').select('*').order('name')
    setStores(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  function openNew() {
    setForm({ name: '', code: '', is_active: true })
    setError('')
    setEditing({})
  }

  function openEdit(store) {
    setForm({ name: store.name, code: store.code, is_active: store.is_active })
    setError('')
    setEditing(store)
  }

  async function save() {
    if (!form.name.trim() || !form.code.trim()) {
      setError('Name and code are both required.')
      return
    }
    setSaving(true)
    setError('')
    const payload = { name: form.name.trim(), code: form.code.trim(), is_active: form.is_active }
    const { error: err } = editing.id
      ? await supabase.from('stores').update(payload).eq('id', editing.id)
      : await supabase.from('stores').insert(payload)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditing(null)
    load()
  }

  async function toggleActive(store) {
    await supabase.from('stores').update({ is_active: !store.is_active }).eq('id', store.id)
    load()
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
                <button onClick={() => toggleActive(s)} className="text-xs font-medium text-brand-600 hover:underline">
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
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </Modal>
    </div>
  )
}
