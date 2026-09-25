import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

export default function StaffDetailModal({ staff, onClose, onSaved }) {
  const { profile: me, currentStoreId, accessibleStores } = useAuth()
  const isAdmin = me?.role === 'admin'
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? 'this store'
  const [form, setForm] = useState({
    first_name: staff.first_name ?? '',
    last_name: staff.last_name ?? '',
    roster_display_name: staff.roster_display_name ?? '',
    phone: staff.phone ?? '',
    email: staff.email ?? '',
    date_of_birth: staff.date_of_birth ?? '',
    hire_date: staff.hire_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save() {
    setSaving(true)
    // date_of_birth/hire_date are DB `date` columns — an unset one loads
    // into this form as '' (see useState above), and PostgREST rejects ''
    // for a date column with a 400 ("invalid input syntax for type date"),
    // which used to fail the WHOLE update (even just a name edit) whenever
    // either date happened to be blank. Send null instead of '' for those.
    // roster_display_name lives on user_stores (one value per store this
    // person is on, not on profiles) — saved separately below, scoped to
    // whichever store is currently selected, so editing it here only
    // changes what this store sees, not every store this person works at.
    const { roster_display_name, ...profileFields } = form
    const payload = { ...profileFields, date_of_birth: form.date_of_birth || null, hire_date: form.hire_date || null }
    // Per spec: hire date is manager/admin editable, but only admin can
    // change it here from Shop Management (managers can still view it).
    if (!isAdmin) delete payload.hire_date
    const [{ error }, { error: nameError }] = await Promise.all([
      supabase.from('profiles').update(payload).eq('id', staff.id),
      supabase
        .from('user_stores')
        .update({ roster_display_name: roster_display_name.trim() || null })
        .eq('profile_id', staff.id)
        .eq('store_id', currentStoreId),
    ])
    setSaving(false)
    if (error || nameError) {
      alert(`Save failed: ${(error || nameError).message}`)
      return
    }
    onSaved()
  }

  async function deactivate() {
    const { error } = await supabase.from('profiles').update({ is_active: false }).eq('id', staff.id)
    if (error) {
      alert(`Remove failed: ${error.message}`)
      return
    }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${staff.first_name} ${staff.last_name}`}
      footer={
        <>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Remove staff
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="First name">
          <input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </Field>
        <Field label="Last name">
          <input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field
          label={`Display name at ${storeName}`}
          hint="Shown instead of the full name wherever other people see it — Bulletin Board, Manage Roster, Leave Schedule, Learning Tracker. Specific to this store — someone working at more than one store can have a different display name at each (switch stores with the picker top right to edit the other one). Leave blank to just use their first name."
          span2
        >
          <input
            className="input"
            placeholder={form.first_name || '(first name)'}
            value={form.roster_display_name}
            onChange={(e) => setForm({ ...form, roster_display_name: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Date of birth">
          <input
            type="date"
            className="input"
            value={form.date_of_birth ?? ''}
            onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
          />
        </Field>
        <Field label="Hire date (admin only)">
          <input
            type="date"
            disabled={!isAdmin}
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            value={form.hire_date ?? ''}
            onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
          />
        </Field>
      </div>

      {confirmDelete && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Remove {staff.first_name} from this store's active staff list? This sets them inactive rather than
          permanently deleting their history.
          <div className="mt-2 flex gap-2">
            <Button variant="danger" onClick={deactivate}>
              Confirm remove
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, hint, span2, children }) {
  return (
    <label className={`block ${span2 ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  )
}
