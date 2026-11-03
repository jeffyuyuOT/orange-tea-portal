import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { roleSelectOptions } from '../../../lib/permissions'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Jeff, 2026-11-03: "能在user management裡最上面新增邀請使用者嗎...邀請時一樣會有
// user編輯介面設定角色跟分店(如果旁邊有篩選分店，則自動勾選篩選的分店)".
//
// Fills in the same things the Edit User window sets for role / store(s), then:
//   1. the invite-user Edge Function creates the login and sends the Supabase
//      invite email (needs the service-role key, so it can't run in the
//      browser) — the signup trigger makes the profile as role 'staff';
//   2. this window then writes the chosen name / role / store(s) onto that new
//      profile, using the admin's own permissions, exactly like UserDetailModal's
//      Save does (including: a store the person is newly added to starts HIDDEN
//      from the roster, and Join store activity defaults off for the 2D Code
//      Maker / Accountant roles).
// Page-level access can be fine-tuned afterwards by opening the person in the
// list as usual.
//
// `defaultStoreId` is the store currently picked in the list's filter (a real
// store id, or '' for "All stores" / "Unassigned") — pre-selected as the
// person's Store.
export default function InviteUserModal({ defaultStoreId = '', onClose, onInvited }) {
  const { profile: me, accessibleStores } = useAuth()
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState('staff')
  const [storeId, setStoreId] = useState(defaultStoreId)
  const [extraStoreIds, setExtraStoreIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggleExtraStore(id) {
    setExtraStoreIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) return
    setBusy(true)

    const { data, error: fnError } = await supabase.functions.invoke('invite-user', {
      body: { email: cleanEmail, redirectTo: `${window.location.origin}/set-password` },
    })
    // A non-2xx reply puts the function's own { error } message inside the
    // response body, not in fnError.message (which is just a generic
    // "non-2xx status code" text).
    let fnMessage = data?.error
    if (fnError && !fnMessage) {
      try {
        fnMessage = (await fnError.context.json())?.error
      } catch {
        fnMessage = fnError.message
      }
    }
    if (fnError || !data?.user_id) {
      setError(fnMessage || 'Invite failed.')
      setBusy(false)
      return
    }
    const newId = data.user_id

    // The invite itself has gone out — everything below only fills in the
    // new profile, so if it fails, say exactly that rather than "invite failed".
    const failSetup = (msg) => {
      setError(`Invite email sent to ${cleanEmail}, but setting their role/store failed: ${msg} Open them in the list and set it there.`)
      setBusy(false)
      onInvited({ stay: true })
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role,
        primary_store_id: storeId || null,
        ...(['qr_code_maker', 'accountant'].includes(role) ? { join_store_activity: false } : null),
      })
      .eq('id', newId)
    if (profileError) return failSetup(profileError.message)

    const storeIds = Array.from(new Set([storeId, ...extraStoreIds].filter(Boolean)))
    if (storeIds.length) {
      const [{ data: existing }, { data: storeRows }] = await Promise.all([
        supabase.from('user_stores').select('store_id').eq('profile_id', newId),
        supabase.from('stores').select('id, disable_roster').in('id', storeIds),
      ])
      const have = new Set((existing ?? []).map((r) => r.store_id))
      const disabled = new Set((storeRows ?? []).filter((s) => s.disable_roster).map((s) => s.id))
      const rows = storeIds
        .filter((id) => !have.has(id))
        .map((id) => ({ profile_id: newId, store_id: id, hidden_from_roster: true, can_view_roster_tab: !disabled.has(id) }))
      if (rows.length) {
        const { error: storeError } = await supabase.from('user_stores').insert(rows)
        if (storeError) return failSetup(storeError.message)
      }
    }

    setBusy(false)
    onInvited({ email: cleanEmail })
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Invite user"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="invite-user-form" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send invite'}
          </Button>
        </>
      }
    >
      <form id="invite-user-form" onSubmit={submit}>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Email</span>
          <input
            className="input"
            type="email"
            required
            autoFocus
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">First name</span>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Last name</span>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Role</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {roleSelectOptions(null, me?.role).map(([key, label]) => (
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

        {accessibleStores.length > 1 && (
          <div className="mb-2">
            <span className="mb-1 block text-xs font-medium text-gray-500">also belong to (in addition to Store above)</span>
            <div className="flex flex-wrap gap-3">
              {accessibleStores
                .filter((s) => s.id !== storeId)
                .map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 text-sm text-gray-600">
                    <input type="checkbox" checked={extraStoreIds.includes(s.id)} onChange={() => toggleExtraStore(s.id)} />
                    {s.name}
                  </label>
                ))}
            </div>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-400">
          They get an email with a link to set their password. Page access can be adjusted afterwards by opening them in
          the list.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  )
}
