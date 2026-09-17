import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { ROLE_LABELS } from '../../../lib/permissions'
import Badge from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import UserDetailModal from './UserDetailModal'

export default function UserManagementPage() {
  const { accessibleStores } = useAuth()
  const [storeFilter, setStoreFilter] = useState('all')
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState(null)

  async function load() {
    let q = supabase.from('profiles').select('*, stores(name)').order('first_name')
    if (storeFilter !== 'all') q = q.eq('primary_store_id', storeFilter)
    const { data } = await q
    setUsers(data ?? [])
  }
  useEffect(() => {
    load()
  }, [storeFilter])

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
    </div>
  )
}
