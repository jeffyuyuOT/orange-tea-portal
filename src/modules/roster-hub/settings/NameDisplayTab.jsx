import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Just "original name -> name shown on the roster" for everyone already
// set up for this store, whether a real account or a Pending staff entry.
// Adding, removing, or linking a Pending staff member to a real account
// once they're formally invited all happens from User Management instead
// — this tab only edits what shows on the roster grid/Excel.
export default function NameDisplayTab() {
  const { currentStoreId } = useAuth()
  const [staff, setStaff] = useState([])
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: memberships }, { data: pendingRows }] = await Promise.all([
      supabase
        .from('user_stores')
        .select('profiles(id, first_name, last_name, roster_display_name, is_active)')
        .eq('store_id', currentStoreId),
      supabase.from('roster_pending_staff').select('*').eq('store_id', currentStoreId).order('created_at'),
    ])
    const people = (memberships ?? [])
      .map((m) => m.profiles)
      .filter((p) => p && p.is_active)
      .sort((a, b) => (a.first_name ?? '').localeCompare(b.first_name ?? ''))
    setStaff(people)
    setPending(pendingRows ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (currentStoreId) load()
  }, [currentStoreId])

  async function saveStaffName(profileId, name) {
    await supabase.from('profiles').update({ roster_display_name: name }).eq('id', profileId)
    setStaff((prev) => prev.map((p) => (p.id === profileId ? { ...p, roster_display_name: name } : p)))
  }

  async function savePendingName(id, name) {
    await supabase.from('roster_pending_staff').update({ roster_display_name: name }).eq('id', id)
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, roster_display_name: name } : p)))
  }

  if (loading) return null

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        The name shown for each person on the roster grid and in Excel import/export — defaults to first name only
        for staff, or their Pending staff name as-is. Add, remove, or link a Pending staff entry from User
        Management.
      </p>

      <h3 className="mb-2 text-sm font-semibold text-brand-700">Staff</h3>
      {!staff.length ? (
        <EmptyState label="No staff assigned to this store yet." />
      ) : (
        <div className="mb-6 divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {staff.map((s) => (
            <NameRow
              key={s.id}
              label={`${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || '(unnamed)'}
              value={s.roster_display_name ?? s.first_name ?? ''}
              onSave={(name) => saveStaffName(s.id, name)}
            />
          ))}
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-brand-700">Pending staff</h3>
      {!pending.length ? (
        <EmptyState label="No pending staff." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {pending.map((p) => (
            <NameRow
              key={p.id}
              label={p.display_name}
              value={p.roster_display_name ?? p.display_name}
              onSave={(name) => savePendingName(p.id, name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// One row: the original name (fixed) plus an editable display-name input
// that only writes back once its Save button is clicked, so a half-typed
// edit is never silently saved on blur.
function NameRow({ label, value, onSave }) {
  const [draft, setDraft] = useState(value)
  const dirty = draft !== value

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-40 shrink-0 text-sm text-gray-500">{label}</span>
      <input className="input flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <Button variant="secondary" disabled={!dirty || !draft.trim()} onClick={() => onSave(draft.trim())}>
        Save
      </Button>
    </div>
  )
}
