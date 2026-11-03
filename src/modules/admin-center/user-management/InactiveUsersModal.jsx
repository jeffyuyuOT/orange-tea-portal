import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { roleLabelFor } from '../../../lib/permissions'
import { invokeFunction } from '../../../lib/invokeFunction'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Jeff, 2026-11-03: "user management invite user下面新增inactive user。點選後視窗
// 列出所有分店inactive的user，然後勾取permanent delete (上面可以選擇全勾選)".
//
// Everyone set inactive (Staff Information's "Remove staff", or the Active
// box in Edit User) across ALL stores. Tick the ones to delete for good —
// "Select all" at the top ticks everyone — then confirm. The actual delete is
// the delete-users Edge Function (removes the Supabase login too).
export default function InactiveUsersModal({ onClose, onChanged }) {
  const { profile: me } = useAuth()
  const [rows, setRows] = useState(null)
  const [checked, setChecked] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { data, error: loadError } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, role, stores!profiles_primary_store_id_fkey(name)')
      .eq('is_active', false)
      .order('first_name')
    if (loadError) {
      setError(loadError.message)
      setRows([])
      return
    }
    // A developer account is hidden from everyone but another developer, same as everywhere else.
    setRows((data ?? []).filter((p) => p.id !== me?.id && (p.role !== 'developer' || me?.role === 'developer')))
  }

  useEffect(() => {
    load()
  }, [])

  const allChecked = !!rows?.length && checked.size === rows.length
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => checked.has(r.id)), [rows, checked])

  function toggle(id) {
    setConfirming(false)
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setConfirming(false)
    setChecked(allChecked ? new Set() : new Set((rows ?? []).map((r) => r.id)))
  }

  async function deleteSelected() {
    setBusy(true)
    setError('')
    const { data, error: fnError } = await invokeFunction('delete-users', { user_ids: selectedRows.map((r) => r.id) })
    setBusy(false)
    if (fnError) {
      setError(fnError)
      return
    }
    const failed = data?.failed ?? []
    setConfirming(false)
    setChecked(new Set(failed.map((f) => f.id)))
    if (failed.length) setError(failed.map((f) => `${f.name}: ${f.error}`).join('\n'))
    onChanged()
    await load()
  }

  const nameOf = (u) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Inactive users"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="danger" disabled={!checked.size || busy} onClick={() => setConfirming(true)}>
            Permanently delete{checked.size ? ` (${checked.size})` : ''}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-500">
        Everyone set inactive across all stores. Tick the people to delete permanently.
      </p>

      {rows === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !rows.length ? (
        <EmptyState label="No inactive users." />
      ) : (
        <div className="rounded-xl border border-brand-100 bg-white">
          <label className="flex items-center gap-3 border-b border-brand-100 bg-brand-50/60 px-4 py-2.5 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            Select all ({rows.length})
          </label>
          <div className="max-h-[45vh] divide-y divide-brand-100 overflow-y-auto">
            {rows.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-brand-50">
                <input type="checkbox" checked={checked.has(u.id)} onChange={() => toggle(u.id)} />
                <span className="font-medium text-gray-800">{nameOf(u)}</span>
                <Badge color="gray">{roleLabelFor(u.role, me?.role)}</Badge>
                {u.stores?.name && <Badge color="brand">{u.stores.name}</Badge>}
                {u.email && u.email !== nameOf(u) && <span className="truncate text-xs text-gray-400">{u.email}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {confirming && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Permanently delete {selectedRows.length} {selectedRows.length === 1 ? 'person' : 'people'}? Their login is removed from
          Supabase and so are their clock in/out records, leave, availability, study and quiz records, and uploaded
          documents. This cannot be undone.
          <div className="mt-2 flex gap-2">
            <Button variant="danger" disabled={busy} onClick={deleteSelected}>
              {busy ? 'Deleting…' : 'Yes, delete permanently'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 whitespace-pre-line text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
