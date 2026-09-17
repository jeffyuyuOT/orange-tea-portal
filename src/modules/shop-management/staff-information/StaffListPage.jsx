import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Badge from '../../../components/ui/Badge'
import { ROLE_LABELS } from '../../../lib/permissions'
import StaffDetailModal from './StaffDetailModal'

export default function StaffListPage() {
  const { currentStoreId } = useAuth()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  async function load() {
    if (!currentStoreId) return
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('primary_store_id', currentStoreId)
      .order('is_active', { ascending: false })
      .order('first_name')
    setStaff(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [currentStoreId])

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Staff Information</h1>
      <p className="mb-4 text-sm text-gray-500">View and edit staff details for this store.</p>

      {loading ? (
        <LoadingSpinner />
      ) : !staff.length ? (
        <EmptyState label="No staff at this store yet. Add them in Admin Center > User Management." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium text-gray-800">
                  {s.first_name} {s.last_name}
                </span>
                <Badge color="gray">{ROLE_LABELS[s.role]}</Badge>
                {!s.is_active && <Badge color="red">Inactive</Badge>}
              </span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <StaffDetailModal
          staff={selected}
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
