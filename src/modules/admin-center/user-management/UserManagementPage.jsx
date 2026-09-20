import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { ROLE_LABELS } from '../../../lib/permissions'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import UserDetailModal from './UserDetailModal'
import PendingStaffModal from './PendingStaffModal'
import LinkPendingStaffModal from './LinkPendingStaffModal'

export default function UserManagementPage() {
  const { accessibleStores } = useAuth()
  const [storeFilter, setStoreFilter] = useState('all')
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState(null)
  const [pending, setPending] = useState([])
  const [editingPending, setEditingPending] = useState(null) // null closed, 'new', or a pending row
  const [linkingPending, setLinkingPending] = useState(null)

  async function load() {
    let q = supabase.from('profiles').select('*, stores(name)').order('first_name')
    if (storeFilter !== 'all') q = q.eq('primary_store_id', storeFilter)
    const { data } = await q
    setUsers(data ?? [])
  }

  async function loadPending() {
    let q = supabase
      .from('pending_staff')
      .select('*, stores(name)')
      .is('linked_profile_id', null)
      .order('created_at', { ascending: false })
    if (storeFilter !== 'all') q = q.eq('primary_store_id', storeFilter)
    const { data } = await q
    setPending(data ?? [])
  }

  useEffect(() => {
    load()
    loadPending()
  }, [storeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  async function removePending(p) {
    const name = `${p.first_name} ${p.last_name ?? ''}`.trim()
    if (!confirm(`Remove pending staff "${name}"?`)) return
    await supabase.from('pending_staff').delete().eq('id', p.id)
    loadPending()
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">User Management</h1>
      <p className="mb-4 text-sm text-gray-500">
        Set each user's role, store, and page-level access. New accounts are created by inviting them via the
        Supabase dashboard (Authentication &gt; Users &gt; Invite) — they'll appear here to configure once they
        sign up. See the README for wiring up a self-service invite flow.
      </p>

      <select className="input mb-4 w-56" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
        <option value="all">All stores</option>
        {accessibleStores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-700">Pending Staff (no login yet)</h2>
          <Button variant="secondary" onClick={() => setEditingPending('new')}>
            + New Pending Staff
          </Button>
        </div>
        <p className="mb-2 text-xs text-gray-400">
          Reserve a name, role, and store for someone before they have login access — they'll show up as a
          selectable row in Manage Roster right away. Once they're invited and sign in through Supabase, link
          their new account here to hand the role/store over and retire this placeholder.
        </p>
        {!pending.length ? (
          <EmptyState label="No pending staff." />
        ) : (
          <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{`${p.first_name} ${p.last_name ?? ''}`.trim()}</span>
                  <Badge color="gray">{ROLE_LABELS[p.role] ?? p.role}</Badge>
                  {p.stores?.name && <Badge color="brand">{p.stores.name}</Badge>}
                </span>
                <span className="flex items-center gap-1">
                  <Button variant="ghost" onClick={() => setLinkingPending(p)}>
                    Link to account
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingPending(p)}>
                    Edit
                  </Button>
                  <button onClick={() => removePending(p)} className="px-2 text-gray-300 hover:text-red-500" title="Remove">
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-brand-700">Active Accounts</h2>
      {!users.length ? (
        <EmptyState label="No users found." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {users.map((u) => (
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
      {editingPending && (
        <PendingStaffModal
          pending={editingPending === 'new' ? null : editingPending}
          onClose={() => setEditingPending(null)}
          onSaved={() => {
            setEditingPending(null)
            loadPending()
          }}
        />
      )}
      {linkingPending && (
        <LinkPendingStaffModal
          pending={linkingPending}
          onClose={() => setLinkingPending(null)}
          onLinked={() => {
            setLinkingPending(null)
            loadPending()
            load()
          }}
        />
      )}
    </div>
  )
}
