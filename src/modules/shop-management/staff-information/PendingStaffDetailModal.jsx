import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Pending staff have no profiles row of their own (profiles.id is a hard
// FK to auth.users), so there's no "edit their details" page for them the
// way there is for real staff — this is just the one field that belongs to
// them that Staff Information covers: the name other people see for them.
// Renaming their original name, removing them, or linking them to a real
// account once they're formally hired all stay in Admin Center > User
// Management, same as before.
export default function PendingStaffDetailModal({ pending, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(pending.roster_display_name ?? pending.display_name ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    await supabase
      .from('roster_pending_staff')
      .update({ roster_display_name: displayName.trim() || null })
      .eq('id', pending.id)
    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={pending.display_name}
      footer={
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className="input bg-gray-50 text-gray-400" value={pending.display_name} disabled />
        </Field>
        <Field
          label="Display name"
          hint="Shown instead of their name wherever other people see it — Bulletin Board, Manage Roster, Leave Schedule, Learning Tracker. Leave blank to just use their name as entered. Rename, remove, or link this Pending staff entry to a real account from Admin Center > User Management."
        >
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  )
}
