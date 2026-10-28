import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { checkForAppUpdate } from '../../../lib/pwaUpdate'
import { getPushPermissionState, relinkPush, subscribeToPush, unsubscribeFromPush } from '../../../lib/webPush'
import Button from '../../../components/ui/Button'
import StaffDocumentsSection from '../../../components/StaffDocumentsSection'
import MyStaffIdModal from './MyStaffIdModal'

export default function MyInformationPage() {
  const { profile, currentStoreId, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [showStaffId, setShowStaffId] = useState(false)
  // Jeff, 2026-10-02: "有沒有什麼辦法...在my information裡設置一個重新整理
  // 的按鈕，讓下載程式可以更新" — '' (idle) | 'checking' | 'updating' |
  // 'uptodate' | 'unsupported'. See lib/pwaUpdate.js for what this actually
  // does and why a manual check is needed at all.
  const [updateStatus, setUpdateStatus] = useState('')
  // Jeff, 2026-10-21 (full Web Push): 'unsupported' | 'ios-needs-install' |
  // 'denied' | 'off' | 'on' | 'working' (subscribing/unsubscribing in
  // flight). See lib/webPush.js for what each state means and why.
  const [pushState, setPushState] = useState('')

  async function handleCheckForUpdate() {
    setUpdateStatus('checking')
    const { supported, updateFound } = await checkForAppUpdate()
    setUpdateStatus(!supported ? 'unsupported' : updateFound ? 'updating' : 'uptodate')
  }

  useEffect(() => {
    if (profile?.id) getPushPermissionState(profile.id).then(setPushState)
  }, [profile?.id])

  async function handleTogglePush() {
    setPushState('working')
    try {
      const current = await getPushPermissionState(profile.id)
      if (current === 'on') {
        await unsubscribeFromPush()
      } else if (current === 'other') {
        await relinkPush(profile.id)
      } else {
        await subscribeToPush(profile.id)
      }
    } catch (e) {
      alert(e.message)
    }
    setPushState(await getPushPermissionState(profile.id))
  }

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

      <section>
        <h2 className="mb-3 text-sm font-semibold text-brand-700">App</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={handleCheckForUpdate}
            disabled={updateStatus === 'checking' || updateStatus === 'updating'}
          >
            {updateStatus === 'checking' ? 'Checking…' : '🔄 Check for Updates'}
          </Button>
          {updateStatus === 'updating' && <p className="text-sm text-brand-600">Update found — reloading…</p>}
          {updateStatus === 'uptodate' && <p className="text-sm text-gray-500">You're already on the latest version.</p>}
          {updateStatus === 'unsupported' && <p className="text-sm text-gray-500">Not available on this browser.</p>}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          If the app ever seems out of date after an update — e.g. after not opening it for a while — tap this instead
          of uninstalling and reinstalling. It'll reload on its own if a newer version is found.
        </p>

        {/* Jeff, 2026-10-21: "還是做完整的 Web Push...這樣員工使用起來才知道
            有訊息可以點進去看" — Message / Bulletin / Roster changes now send
            a real push notification (see migration + supabase/functions/send-push).
            This is where someone turns it on for this device; AppShell.jsx also
            offers a one-time nudge banner so this isn't the only way to find it. */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {pushState === 'ios-needs-install' ? (
            <p className="text-sm text-gray-500">
              Add OT Portal to your home screen first to turn on push notifications: tap Safari's share button → "Add to
              Home Screen", then open it from the home screen icon.
            </p>
          ) : pushState === 'unsupported' ? (
            <p className="text-sm text-gray-500">Push notifications aren't supported in this browser.</p>
          ) : pushState === 'denied' ? (
            <p className="text-sm text-gray-500">Notification permission was denied — turn it on from your phone/browser's notification settings.</p>
          ) : (
            <>
              <Button variant="secondary" onClick={handleTogglePush} disabled={pushState === 'working' || pushState === ''}>
                {pushState === 'working'
                  ? 'Working…'
                  : pushState === 'on'
                    ? '🔕 Turn off push notifications'
                    : pushState === 'other'
                      ? '🔔 Link this device to my account'
                      : '🔔 Turn on push notifications'}
              </Button>
              {pushState === 'on' && <span className="text-sm text-green-600">On for this account</span>}
              {pushState === 'other' && (
                <span className="text-sm text-amber-600">
                  Push on this device is not linked to this account (it may be linked to another account).
                </span>
              )}
            </>
          )}
        </div>
      </section>

      <StaffDocumentsSection profileId={profile?.id} storeId={currentStoreId} ownView />

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
