import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Badge from '../../../components/ui/Badge'
import { ROLE_LABELS } from '../../../lib/permissions'
import { rosterDisplayName, pendingRosterName } from '../../../lib/excelRoster'
import StaffDetailModal from './StaffDetailModal'
import PendingStaffDetailModal from './PendingStaffDetailModal'

export default function StaffListPage() {
  const { currentStoreId } = useAuth()
  const [staff, setStaff] = useState([])
  const [pendingStaff, setPendingStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [selectedPending, setSelectedPending] = useState(null)

  async function load() {
    if (!currentStoreId) return
    setLoading(true)
    const [{ data: staffRows }, { data: pendingRows }] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('primary_store_id', currentStoreId)
        .order('is_active', { ascending: false })
        .order('first_name'),
      supabase.from('roster_pending_staff').select('*').eq('store_id', currentStoreId).order('created_at'),
    ])
    setStaff(staffRows ?? [])
    setPendingStaff(pendingRows ?? [])
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
      ) : (
        <>
          <h2 className="mb-2 text-sm font-semibold text-brand-700">Staff</h2>
          {!staff.length ? (
            <EmptyState label="No staff at this store yet. Add them in Admin Center > User Management." />
          ) : (
            <div className="mb-6 divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
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
                    {s.roster_display_name && (
                      <span className="text-xs text-gray-400">shown as "{rosterDisplayName(s)}"</span>
                    )}
                    <Badge color="gray">{ROLE_LABELS[s.role]}</Badge>
                    {!s.is_active && <Badge color="red">Inactive</Badge>}
                  </span>
                  <span className="text-gray-300">›</span>
                </button>
              ))}
            </div>
          )}

          {/* Pending staff — imported from a roster upload or added ahead of
              time, but not yet linked to a real account in User Management
              (see Admin Center > User Management). The only thing about
              them that lives here is the name other people see for them;
              renaming, removing, or linking them stays in User Management. */}
          <h2 className="mb-2 text-sm font-semibold text-brand-700">Pending staff</h2>
          {!pendingStaff.length ? (
            <EmptyState label="No pending staff at this store." />
          ) : (
            <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
              {pendingStaff.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPending(p)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{p.display_name}</span>
                    {p.roster_display_name && (
                      <span className="text-xs text-gray-400">shown as "{pendingRosterName(p)}"</span>
                    )}
                    <Badge color="gray">Pending</Badge>
                  </span>
                  <span className="text-gray-300">›</span>
                </button>
              ))}
            </div>
          )}
        </>
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
      {selectedPending && (
        <PendingStaffDetailModal
          pending={selectedPending}
          onClose={() => setSelectedPending(null)}
          onSaved={() => {
            setSelectedPending(null)
            load()
          }}
        />
      )}
    </div>
  )
}
