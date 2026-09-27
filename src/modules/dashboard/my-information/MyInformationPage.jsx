import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import StaffDocumentsSection from '../../../components/StaffDocumentsSection'
import MyStaffIdModal from './MyStaffIdModal'

export default function MyInformationPage() {
  const { profile, currentStoreId, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [showStaffId, setShowStaffId] = useState(false)

  useEffect(() => {
    if (profile) {
      setForm({
        first_name: profile.first_name ?? '',
        last_name: profile.last_name ?? '',
        phone: profile.phone ?? '',
        date_of_birth: profile.date_of_birth ?? '',
        email: profile.email ?? '',
        tax_file_number: profile.tax_file_number ?? '',
        // Address + banking (migration 0060) — kept on `profiles` the same
        // as everything else here, and readable/editable from Staff
        // Information too (StaffDetailModal.jsx) since both pages read
        // and write the same columns. Display name and Hire date are the
        // deliberate exception: those two stay on Staff Information only.
        address: profile.address ?? '',
        bank_account_name: profile.bank_account_name ?? '',
        bsb: profile.bsb ?? '',
        account_number: profile.account_number ?? '',
      })
    }
  }, [profile])

  async function save() {
    setSaving(true)
    // An empty date input sends '' — Postgres's `date` column rejects that
    // outright (invalid input syntax for type date), which PostgREST
    // surfaces as an opaque HTTP 400 with no field-level detail in the UI.
    // Anyone who hasn't filled in a date of birth yet hits this on every
    // save, not just when editing the date field itself.
    const payload = { ...form, date_of_birth: form.date_of_birth || null }
    const { error } = await supabase.from('profiles').update(payload).eq('id', profile.id)
    if (error) alert(`Save failed: ${error.message}`)
    await refreshProfile()
    setSaving(false)
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">My Information</h1>
        <Button variant="secondary" onClick={() => setShowStaffId(true)}>
          🪪 My Staff ID
        </Button>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-brand-700">Personal Details</h2>
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
          <Field label="Date of birth">
            <input
              type="date"
              className="input"
              value={form.date_of_birth ?? ''}
              onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Tax File Number">
            <input
              className="input"
              value={form.tax_file_number}
              onChange={(e) => setForm({ ...form, tax_file_number: e.target.value })}
            />
          </Field>
          <Field label="Address" span2>
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
        </div>
        <Button className="mt-3" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-brand-700">Bank Details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Bank account name">
            <input
              className="input"
              value={form.bank_account_name}
              onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })}
            />
          </Field>
          <Field label="BSB">
            <input className="input" value={form.bsb} onChange={(e) => setForm({ ...form, bsb: e.target.value })} />
          </Field>
          <Field label="Account number">
            <input
              className="input"
              value={form.account_number}
              onChange={(e) => setForm({ ...form, account_number: e.target.value })}
            />
          </Field>
        </div>
        <Button className="mt-3" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-brand-700">Account</h2>
        <Button variant="secondary" onClick={() => navigate('/set-password')}>
          Change password
        </Button>
      </section>

      <StaffDocumentsSection profileId={profile?.id} storeId={currentStoreId} />

      {showStaffId && <MyStaffIdModal onClose={() => setShowStaffId(false)} />}
    </div>
  )
}

function Field({ label, span2, children }) {
  return (
    <label className={`block ${span2 ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  )
}
