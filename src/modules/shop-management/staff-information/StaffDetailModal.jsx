import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

export default function StaffDetailModal({ staff, onClose, onSaved }) {
  const { profile: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [form, setForm] = useState({
    first_name: staff.first_name ?? '',
    last_name: staff.last_name ?? '',
    phone: staff.phone ?? '',
    email: staff.email ?? '',
    date_of_birth: staff.date_of_birth ?? '',
    hire_date: staff.hire_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save() {
    setSaving(true)
    const payload = { ...form }
    // Per spec: hire date is manager/admin editable, but only admin can
    // change it here from Shop Management (managers can still view it).
    if (!isAdmin) delete payload.hire_date
    await supabase.from('profiles').update(payload).eq('id', staff.id)
    setSaving(false)
    onSaved()
  }

  async function deactivate() {
    await supabase.from('profiles').update({ is_active: false }).eq('id', staff.id)
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

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  )
}
