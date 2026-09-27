import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { NON_PICKABLE_STAFF_ROLES } from '../../../lib/permissions'
import AttendanceLogTable from '../../dashboard/time-attendance/AttendanceLogTable'

// Manager-facing view of the same Attendance Logs table each employee sees
// for themselves under My Dashboard > Time & Attendance — a manager just
// picks who to look at first. Staff list follows the same "via user_stores,
// not primary_store_id" pattern as Staff Information, so someone assigned
// to more than one store shows up here at each of them.
export default function StaffTimeLogsPage() {
  const { currentStoreId } = useAuth()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!currentStoreId) return
    let active = true
    setLoading(true)
    setSelected(null)
    setSearch('')
    supabase
      .from('user_stores')
      .select('profiles(*)')
      .eq('store_id', currentStoreId)
      .then(({ data }) => {
        if (!active) return
        const rows = (data ?? [])
          .map((m) => m.profiles)
          .filter((p) => p && p.is_active && !NON_PICKABLE_STAFF_ROLES.includes(p.role))
          .sort((a, b) => (a.first_name ?? '').localeCompare(b.first_name ?? ''))
        setStaff(rows)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [currentStoreId])

  const query = search.trim().toLowerCase()
  const filtered = query
    ? staff.filter((s) => `${s.first_name ?? ''} ${s.last_name ?? ''}`.toLowerCase().includes(query))
    : staff

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Staff Time Logs</h1>
      <p className="mb-4 text-sm text-gray-500">Pick a staff member to view their clock in/out history.</p>

      {loading ? (
        <LoadingSpinner />
      ) : !staff.length ? (
        <EmptyState label="No active staff at this store yet." />
      ) : (
        <>
          <input
            type="text"
            className="input mb-3"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!filtered.length ? (
            <EmptyState label="No staff match that search." />
          ) : (
            <div className="mb-5 divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50 ${
                    selected?.id === s.id ? 'bg-brand-50' : ''
                  }`}
                >
                  <span className="font-medium text-gray-800">
                    {s.first_name} {s.last_name}
                  </span>
                  <span className="text-gray-300">›</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-brand-700">
            {selected.first_name} {selected.last_name}
          </h2>
          <AttendanceLogTable profileId={selected.id} storeId={currentStoreId} />
        </div>
      )}
    </div>
  )
}
