import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import StaffDocumentsSection from '../../../components/StaffDocumentsSection'

export default function StaffDetailModal({ staff, onClose, onSaved }) {
  const { profile: me, currentStoreId, accessibleStores } = useAuth()
  // Jeff, 2026-09 (later): Hire date used to be admin/developer-only here —
  // now shop_manager can edit it too, same as every other field on this
  // modal (the only role gate left is isReadOnly/accountant below, which
  // already hides the Save button entirely, so accountant can't write
  // anything regardless of individual fields' disabled state).
  // Accountant is view-only everywhere on this page (per Jeff: "只能看到"
  // — can only SEE) — the cash-in-hand filtering that keeps someone off
  // this list entirely happens earlier, in StaffListPage.jsx/RLS (see
  // migration 0060_accountant_role_and_profile_fields.sql); this is just
  // what stops that role from editing anyone it CAN see.
  const isReadOnly = me?.role === 'accountant'
  // Jeff, 2026-09-30: "staff information的TFN移到Address下面...只有
  // developer,admin跟accountant看的到...在shop managerment裡新增可勾取
  // Staff confidential，如果有勾取的話則可以看到...manager預設不勾取" --
  // developer/admin/accountant always see TFN/bank/documents; a
  // shop_manager only does with the new can_view_staff_confidential flag
  // (UserDetailModal.jsx's Shop Management permissions, off by default —
  // same per-profile-column pattern as can_edit_attendance_logs).
  //
  // Note this is a UI-level gate only, same class of protection as the
  // rest of this modal's isReadOnly/disabled logic — every manager/admin/
  // developer already has RLS SELECT access to the full profiles row
  // (migration 0060's "read own or same-store profiles" policy is
  // row-level, not column-level), so this stops the fields from being
  // SHOWN to a manager without the flag, not from being read via a direct
  // Supabase query. Flag for Jeff if stronger (DB-level) enforcement is
  // ever needed — see handoff notes.
  const canViewConfidential = ['admin', 'developer', 'accountant'].includes(me?.role) || !!me?.can_view_staff_confidential
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? 'this store'
  const [form, setForm] = useState({
    first_name: staff.first_name ?? '',
    last_name: staff.last_name ?? '',
    roster_display_name: staff.roster_display_name ?? '',
    phone: staff.phone ?? '',
    email: staff.email ?? '',
    date_of_birth: staff.date_of_birth ?? '',
    hire_date: staff.hire_date ?? '',
    tax_file_number: staff.tax_file_number ?? '',
    // Shared with My Information (same `profiles` columns, migration
    // 0060) — Display name and Hire date above are the only two fields on
    // this modal that DON'T also show on My Information.
    address: staff.address ?? '',
    bank_account_name: staff.bank_account_name ?? '',
    bsb: staff.bsb ?? '',
    account_number: staff.account_number ?? '',
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
        isReadOnly ? null : (
          <>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Remove staff
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="First name">
          <input
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            disabled={isReadOnly}
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          />
        </Field>
        <Field label="Last name">
          <input
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            disabled={isReadOnly}
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          />
        </Field>
        <Field
          label={`Display name at ${storeName}`}
          hint="Shown instead of the full name wherever other people see it — Bulletin Board, Manage Roster, Leave Schedule, Learning Tracker. Specific to this store — someone working at more than one store can have a different display name at each (switch stores with the picker top right to edit the other one). Leave blank to just use their first name. Only shown here on Staff Information, not on My Information."
          span2
        >
          <input
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            disabled={isReadOnly}
            placeholder={form.first_name || '(first name)'}
            value={form.roster_display_name}
            onChange={(e) => setForm({ ...form, roster_display_name: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <input
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            disabled={isReadOnly}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            disabled={isReadOnly}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Date of birth">
          <input
            type="date"
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            disabled={isReadOnly}
            value={form.date_of_birth ?? ''}
            onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
          />
        </Field>
        <Field label="Hire date (staff information only)">
          <input
            type="date"
            disabled={isReadOnly}
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            value={form.hire_date ?? ''}
            onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
          />
        </Field>
        <Field label="Address" span2>
          <input
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            disabled={isReadOnly}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>
        {canViewConfidential && (
          <>
            <Field label="Tax File Number">
              <input
                className="input disabled:bg-gray-50 disabled:text-gray-400"
                disabled={isReadOnly}
                value={form.tax_file_number}
                onChange={(e) => setForm({ ...form, tax_file_number: e.target.value })}
              />
            </Field>
            <Field label="Bank account name">
              <input
                className="input disabled:bg-gray-50 disabled:text-gray-400"
                disabled={isReadOnly}
                value={form.bank_account_name}
                onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })}
              />
            </Field>
            <Field label="BSB">
              <input
                className="input disabled:bg-gray-50 disabled:text-gray-400"
                disabled={isReadOnly}
                value={form.bsb}
                onChange={(e) => setForm({ ...form, bsb: e.target.value })}
              />
            </Field>
            <Field label="Account number">
              <input
                className="input disabled:bg-gray-50 disabled:text-gray-400"
                disabled={isReadOnly}
                value={form.account_number}
                onChange={(e) => setForm({ ...form, account_number: e.target.value })}
              />
            </Field>
          </>
        )}
      </div>

      {!isReadOnly && confirmDelete && (
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

      {canViewConfidential && (
        <div className="mt-6">
          <StaffDocumentsSection profileId={staff.id} storeId={currentStoreId} readOnly={isReadOnly} />
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
