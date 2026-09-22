import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { SECTIONS, ROLE_LABELS, getEffectivePages } from '../../../lib/permissions'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

export default function UserDetailModal({ user, onClose, onSaved }) {
  const { profile: me, accessibleStores } = useAuth()
  const [role, setRole] = useState(user.role)
  const [storeId, setStoreId] = useState(user.primary_store_id ?? '')
  const [isActive, setIsActive] = useState(user.is_active)
  const [overrides, setOverrides] = useState({}) // page_key -> boolean (explicit override) or undefined
  // Store(s) this person shows up on the roster for, beyond their primary
  // Store above — e.g. an admin who only actually works a couple of
  // stores, not every store the way `role: admin` used to imply for roster
  // purposes. Backed by user_stores (see migration 0027).
  const [extraStoreIds, setExtraStoreIds] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('permission_overrides')
      .select('*')
      .eq('profile_id', user.id)
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((o) => (map[o.page_key] = o.allowed))
        setOverrides(map)
      })
    supabase
      .from('user_stores')
      .select('store_id')
      .eq('profile_id', user.id)
      .then(({ data }) => {
        setExtraStoreIds((data ?? []).map((r) => r.store_id).filter((id) => id !== (user.primary_store_id ?? '')))
      })
  }, [user.id, user.primary_store_id])

  function toggleExtraStore(id) {
    setExtraStoreIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const effective = getEffectivePages(
    { role },
    Object.entries(overrides).map(([page_key, allowed]) => ({ page_key, allowed }))
  )

  function togglePage(pageKey, roleDefault) {
    setOverrides((prev) => {
      const current = pageKey in prev ? prev[pageKey] : roleDefault
      const next = !current
      const copy = { ...prev }
      if (next === roleDefault) delete copy[pageKey] // back to role default, no override needed
      else copy[pageKey] = next
      return copy
    })
  }

  async function save() {
    setSaving(true)
    await supabase.from('profiles').update({ role, primary_store_id: storeId || null, is_active: isActive }).eq('id', user.id)
    await supabase.from('permission_overrides').delete().eq('profile_id', user.id)
    const rows = Object.entries(overrides).map(([page_key, allowed]) => ({
      profile_id: user.id,
      page_key,
      allowed,
      updated_by: me.id,
    }))
    if (rows.length) await supabase.from('permission_overrides').insert(rows)

    // Sync user_stores to exactly {Store above} ∪ {checked extra stores} —
    // this is what Manage Roster / Name display use to decide which
    // store(s) this person appears on, instead of assuming an admin
    // belongs on every store's roster.
    const storeIds = Array.from(new Set([storeId, ...extraStoreIds].filter(Boolean)))
    await supabase.from('user_stores').delete().eq('profile_id', user.id)
    if (storeIds.length) {
      await supabase.from('user_stores').insert(storeIds.map((id) => ({ profile_id: user.id, store_id: id })))
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email}
      footer={
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="mb-5 grid grid-cols-3 gap-3">
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
        <label className="mt-5 flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>

      {accessibleStores.length > 1 && (
        <div className="mb-5">
          <span className="mb-1 block text-xs font-medium text-gray-500">Also on the roster at (in addition to Store above)</span>
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
          <p className="mt-1 text-xs text-gray-400">
            For someone (e.g. an admin) working more than one store — they only show up on a store's Manage
            Roster / Name display if it's their Store above or checked here.
          </p>
        </div>
      )}

      <h4 className="mb-2 text-sm font-semibold text-brand-700">Page Access</h4>
      <div className="space-y-3">
        {Object.entries(SECTIONS).map(([sectionKey, section]) => (
          <div key={sectionKey}>
            <p className="mb-1 text-xs font-semibold uppercase text-gray-400">{section.label}</p>
            <div className="flex flex-wrap gap-3">
              {Object.entries(section.pages).map(([pageKey, pageLabel]) => {
                const fullKey = `${sectionKey}.${pageKey}`
                const checked = effective.has(fullKey)
                const isOverridden = fullKey in overrides
                return (
                  <label key={fullKey} className={`flex items-center gap-1.5 text-sm ${isOverridden ? 'text-brand-700 font-medium' : 'text-gray-600'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const roleDefaultSet = getEffectivePages({ role }, [])
                        togglePage(fullKey, roleDefaultSet.has(fullKey))
                      }}
                    />
                    {pageLabel}
                    {isOverridden && <span className="text-brand-400">*</span>}
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-400">* = overridden from the {ROLE_LABELS[role]} role default</p>
    </Modal>
  )
}
