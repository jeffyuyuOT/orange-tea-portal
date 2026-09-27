import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
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
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (!currentStoreId) return
    let active = true
    setLoading(true)
    setSelectedId(null)
    supabase
      .from('user_stores')
      .select('profiles(*)')
      .eq('store_id', currentStoreId)
      .then(({ data }) => {
        if (!active) return
        const rows = (data ?? [])
          .map((m) => m.profiles)
          .filter((p) => p && p.is_active)
          .sort((a, b) => (a.first_name ?? '').localeCompare(b.first_name ?? ''))
        setStaff(rows)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [currentStoreId])

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Staff Time Logs</h1>
      <p className="mb-4 text-sm text-gray-500">Pick a staff member to view their clock in/out history.</p>

      {loading ? (
        <LoadingSpinner />
      ) : !staff.length ? (
        <EmptyState label="No active staff at this store yet." />
      ) : (
        <div className="mb-5 flex flex-wrap gap-2">
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                selectedId === s.id
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-brand-200 bg-white text-gray-700 hover:bg-brand-50'
              }`}
            >
              {s.first_name} {s.last_name}
            </button>
          ))}
        </div>
      )}

      {selectedId && <AttendanceLogTable profileId={selectedId} />}
    </div>
  )
}
