import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { ROLE_LABELS } from '../../../lib/permissions'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Create/edit form for a "pending staff" placeholder — a name + role + store
// reserved for someone before they have login access, so they can be
// scheduled right away and formally onboarded (linked to a real account)
// once they're invited and sign in.
export default function PendingStaffModal({ pending, onClose, onSaved }) {
  const { profile: me, accessibleStores, currentStoreId } = useAuth()
  const isNew = !pending
  const [firstName, setFirstName] = useState(pending?.first_name ?? '')
  const [lastName, setLastName] = useState(pending?.last_name ?? '')
  const [role, setRole] = useState(pending?.role ?? 'staff')
  const [storeId, setStoreId] = useState(pending?.primary_store_id ?? currentStoreId ?? '')
  const [notes, setNotes] = useState(pending?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!firstName.trim() || !storeId) return
    setSaving(true)
    const payload = {
      first_name: firstName.trim(),
      last_name: lastName.trim() || null,
      role,
      primary_store_id: storeId,
      notes: notes.trim() || null,
    }
    const { error } = isNew
      ? await supabase.from('pending_staff').insert({
          ...payload,
          created_by: me.id,
          created_by_name: `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim() || me.email,
        })
      : await supabase.from('pending_staff').update(payload).eq('id', pending.id)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New Pending Staff' : 'Edit Pending Staff'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !firstName.trim() || !storeId}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">First name</span>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Last name</span>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Role</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Store</span>
            <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">—</option>
              {accessibleStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Notes</span>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
    </Modal>
  )
}
