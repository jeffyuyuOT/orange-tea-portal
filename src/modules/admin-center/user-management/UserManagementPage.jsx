import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { ROLE_LABELS } from '../../../lib/permissions'
import { pendingRosterName } from '../../../lib/excelRoster'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import UserDetailModal from './UserDetailModal'

export default function UserManagementPage() {
  const { accessibleStores } = useAuth()
  const [storeFilter, setStoreFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState(null)
  // Pending staff — someone to schedule and try out before formally
  // inviting them in Supabase, no account needed yet (see migration
  // 0027's comment on roster_pending_staff). Managed here alongside real
  // accounts since both answer "who is this store's roster for"; Roster
  // Hub > Setting > Name display only edits what name shows on the roster.
  const [pendingList, setPendingList] = useState([])
  const [staffByStore, setStaffByStore] = useState({}) // store_id -> active profiles, for the Link-to picker
  const [newPendingName, setNewPendingName] = useState('')
  const [addingPending, setAddingPending] = useState(false)
  const [removingPendingId, setRemovingPendingId] = useState(null)
  const [linkingId, setLinkingId] = useState(null)

  // profiles<->stores now has two possible join paths — the direct
  // primary_store_id fk, and the many-to-many via user_stores (added in
  // migration 0027) — so PostgREST can't auto-pick one for a plain
  // "stores(name)" embed (PGRST201, ambiguous embedding) and errors out;
  // every embed of stores from profiles must name the fk explicitly.
  async function load() {
    if (storeFilter === 'all') {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, stores!profiles_primary_store_id_fkey(name)')
        .order('first_name')
      if (error) console.error('load users failed', error)
      setUsers(data ?? [])
      return
    }
    // A person can now be on a store's roster via user_stores without it
    // being their primary_store_id (see migration 0027 — e.g. an admin
    // added to a second store without changing their home store), so
    // filtering by primary_store_id alone here would hide them even though
    // they do show up on that store's Manage Roster / Name display.
    const [{ data: primaryMatches, error: err1 }, { data: memberships, error: err2 }] = await Promise.all([
      supabase.from('profiles').select('*, stores!profiles_primary_store_id_fkey(name)').eq('primary_store_id', storeFilter),
      supabase.from('user_stores').select('profiles(*, stores!profiles_primary_store_id_fkey(name))').eq('store_id', storeFilter),
    ])
    if (err1 || err2) console.error('load users failed', err1 ?? err2)
    const byId = new Map()
    ;(primaryMatches ?? []).forEach((p) => byId.set(p.id, p))
    ;(memberships ?? []).forEach((m) => m.profiles && byId.set(m.profiles.id, m.profiles))
    setUsers(Array.from(byId.values()).sort((a, b) => (a.first_name ?? '').localeCompare(b.first_name ?? '')))
  }

  async function loadPending() {
    let q = supabase.from('roster_pending_staff').select('*, stores(name)').order('created_at')
    if (storeFilter !== 'all') q = q.eq('store_id', storeFilter)
    const { data } = await q
    setPendingList(data ?? [])
    // The Link-to picker for a pending row needs that row's own store's
    // active staff — fetch each distinct store once rather than per row.
    const storeIds = Array.from(new Set((data ?? []).map((p) => p.store_id)))
    if (!storeIds.length) {
      setStaffByStore({})
      return
    }
    const results = await Promise.all(
      storeIds.map((id) => supabase.from('user_stores').select('profiles(id, first_name, last_name, is_active)').eq('store_id', id))
    )
    const map = {}
    storeIds.forEach((id, i) => {
      map[id] = (results[i].data ?? []).map((r) => r.profiles).filter((p) => p && p.is_active)
    })
    setStaffByStore(map)
  }

  useEffect(() => {
    load()
    loadPending()
  }, [storeFilter])

  async function addPending() {
    const name = newPendingName.trim()
    if (!name || storeFilter === 'all') return
    setAddingPending(true)
    const { data } = await supabase
      .from('roster_pending_staff')
      .insert({ store_id: storeFilter, display_name: name })
      .select('*, stores(name)')
      .single()
    if (data) setPendingList((prev) => [...prev, data])
    setNewPendingName('')
    setAddingPending(false)
  }

  async function removePending(id) {
    setRemovingPendingId(id)
    await supabase.from('roster_pending_staff').delete().eq('id', id)
    setPendingList((prev) => prev.filter((p) => p.id !== id))
    setRemovingPendingId(null)
  }

  // Once a pending person is properly invited (a real profile now exists
  // for them), this folds their trial history into that account instead of
  // leaving it stranded under the old pending name: every roster_entries
  // row still keyed by the name they were scheduled under (no profile_id
  // of its own to match on) gets pointed at the real profile, then the
  // pending entry itself is removed.
  async function linkPending(pending, profileId) {
    if (!profileId) return
    setLinkingId(pending.id)
    await supabase.from('roster_entries').update({ profile_id: profileId }).eq('staff_name_raw', pendingRosterName(pending)).is('profile_id', null)
    await supabase.from('roster_pending_staff').delete().eq('id', pending.id)
    setPendingList((prev) => prev.filter((p) => p.id !== pending.id))
    setLinkingId(null)
  }

  const visibleUsers = search.trim()
    ? users.filter((u) => `${u.first_name ?? ''} ${u.last_name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    : users

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">User Management</h1>
      <p className="mb-4 text-sm text-gray-500">
        Set each user's role, store, and page-level access. New accounts are created by inviting them via the
        Supabase dashboard (Authentication &gt; Users &gt; Invite) — they'll appear here to configure once they
        sign up. See the README for wiring up a self-service invite flow.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input w-56" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
          <option value="all">All stores</option>
          {accessibleStores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          className="input w-56"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!visibleUsers.length ? (
        <EmptyState label="No users found." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {visibleUsers.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelected(u)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium text-gray-800">
                  {u.first_name || u.last_name ? `${u.first_name ?? ''} ${u.last_name ?? ''}` : u.email}
                </span>
                <Badge color="gray">{ROLE_LABELS[u.role] ?? u.role}</Badge>
                {u.stores?.name && <Badge color="brand">{u.stores.name}</Badge>}
                {!u.is_active && <Badge color="red">Inactive</Badge>}
              </span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <UserDetailModal
          user={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null)
            load()
          }}
        />
      )}

      <h2 className="mb-1 mt-8 text-lg font-semibold text-gray-900">Pending staff</h2>
      <p className="mb-3 text-sm text-gray-500">
        Someone to schedule and try out on the roster before formally inviting them in Supabase — no account needed
        yet. Once you do invite them for real, use "Link to" to fold their trial hours into the new account.
      </p>
      {!pendingList.length ? (
        <EmptyState label="No pending staff." />
      ) : (
        <div className="mb-3 divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {pendingList.map((p) => (
            <PendingRow
              key={p.id}
              pending={p}
              storeLabel={storeFilter === 'all' ? p.stores?.name : null}
              staffOptions={staffByStore[p.store_id] ?? []}
              onSave={(name) => {
                supabase.from('roster_pending_staff').update({ display_name: name }).eq('id', p.id)
                setPendingList((prev) => prev.map((row) => (row.id === p.id ? { ...row, display_name: name } : row)))
              }}
              onRemove={() => removePending(p.id)}
              removing={removingPendingId === p.id}
              onLink={(profileId) => linkPending(p, profileId)}
              linking={linkingId === p.id}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Name"
          value={newPendingName}
          disabled={storeFilter === 'all'}
          onChange={(e) => setNewPendingName(e.target.value)}
        />
        <Button variant="secondary" disabled={storeFilter === 'all' || addingPending || !newPendingName.trim()} onClick={addPending}>
          + Add pending staff
        </Button>
        {storeFilter === 'all' && <span className="text-xs text-gray-400">Pick a specific store above to add one.</span>}
      </div>
    </div>
  )
}

// A pending row's own name (editable here — this is the "original name"
// Name display shows next to its roster-only override) plus the day-it-
// becomes-real "Link to" control and remove.
function PendingRow({ pending, storeLabel, staffOptions, onSave, onRemove, removing, onLink, linking }) {
  const [draft, setDraft] = useState(pending.display_name)
  const dirty = draft !== pending.display_name
  const [linkTarget, setLinkTarget] = useState('')

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      {storeLabel && <Badge color="brand">{storeLabel}</Badge>}
      <input className="input flex-1 basis-48" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <Button variant="secondary" disabled={!dirty || !draft.trim()} onClick={() => onSave(draft.trim())}>
        Save
      </Button>
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <span>Link to</span>
        <select className="input !w-40 !py-1" value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)}>
          <option value="">Select staff…</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || '(unnamed)'}
            </option>
          ))}
        </select>
        <Button variant="secondary" disabled={!linkTarget || linking} onClick={() => onLink(linkTarget)}>
          {linking ? 'Linking…' : 'Link'}
        </Button>
      </div>
      <button
        onClick={onRemove}
        disabled={removing}
        className="ml-auto text-gray-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
        title="Remove this pending entry"
      >
        ✕
      </button>
    </div>
  )
}
