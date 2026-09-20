import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { ROLE_LABELS } from '../../../lib/permissions'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Links a pending-staff placeholder to a real (already-signed-up) profile:
// copies the placeholder's role/store onto that account and marks the
// placeholder as linked so it drops out of the active list (and the Manage
// Roster picker) while staying around as a record of who it was.
export default function LinkPendingStaffModal({ pending, onClose, onLinked }) {
  const [candidates, setCandidates] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, first_name, last_name, email, primary_store_id'),
      supabase.from('pending_staff').select('linked_profile_id').not('linked_profile_id', 'is', null),
    ]).then(([{ data: profileRows }, { data: linkedRows }]) => {
      const alreadyLinked = new Set((linkedRows ?? []).map((r) => r.linked_profile_id))
      setCandidates((profileRows ?? []).filter((p) => !alreadyLinked.has(p.id)))
      setLoading(false)
    })
  }, [])

  async function link() {
    if (!selectedId) return
    setSaving(true)
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ role: pending.role, primary_store_id: pending.primary_store_id })
      .eq('id', selectedId)
    if (profileError) {
      alert(profileError.message)
      setSaving(false)
      return
    }
    const { error } = await supabase
      .from('pending_staff')
      .update({ linked_profile_id: selectedId, linked_at: new Date().toISOString() })
      .eq('id', pending.id)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    onLinked()
  }

  // Same store first, then everyone else — the placeholder's guessed store
  // won't always match where the person actually ends up signing up from.
  const sameStore = candidates.filter((c) => c.primary_store_id === pending.primary_store_id)
  const otherCandidates = candidates.filter((c) => c.primary_store_id !== pending.primary_store_id)
  const pendingName = `${pending.first_name} ${pending.last_name ?? ''}`.trim()

  return (
    <Modal
      open
      onClose={onClose}
      title={`Link "${pendingName}" to an account`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={link} disabled={!selectedId || saving}>
            {saving ? 'Linking…' : 'Link'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-gray-400">
        Pick the account this person signed up with. Their role and store will be set to match this placeholder (
        {ROLE_LABELS[pending.role] ?? pending.role}).
      </p>
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !candidates.length ? (
        <EmptyState label="No unlinked accounts yet — invite them via the Supabase dashboard first." />
      ) : (
        <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">—</option>
          {sameStore.length > 0 && (
            <optgroup label="This store">
              {sameStore.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email}
                </option>
              ))}
            </optgroup>
          )}
          {otherCandidates.length > 0 && (
            <optgroup label="Other / no store">
              {otherCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
    </Modal>
  )
}
