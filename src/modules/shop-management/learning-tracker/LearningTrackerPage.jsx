import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Badge from '../../../components/ui/Badge'
import { rosterDisplayName } from '../../../lib/excelRoster'
import { NON_PICKABLE_STAFF_ROLES } from '../../../lib/permissions'
import StaffStudyDetail from './StaffStudyDetail'

export default function LearningTrackerPage() {
  const { currentStoreId } = useAuth()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  function load() {
    if (!currentStoreId) return
    setLoading(true)
    // Staff at THIS store via user_stores (not just primary_store_id), same
    // as Manage Roster/Staff Information — someone working at more than one
    // store shows up here at each of them, with that store's own display
    // name (roster_display_name lives on the user_stores row, per store).
    supabase
      .from('user_stores')
      .select('roster_display_name, profiles(*)')
      .eq('store_id', currentStoreId)
      .then(({ data }) => {
        const rows = (data ?? [])
          .map((m) => (m.profiles?.is_active ? { ...m.profiles, roster_display_name: m.roster_display_name } : null))
          .filter((p) => p && !NON_PICKABLE_STAFF_ROLES.includes(p.role))
        // Re-sort by the same display name shown below, so the list order
        // matches what's actually on screen instead of each person's
        // (possibly different) raw first name.
        const sorted = rows.sort((a, b) => rosterDisplayName(a).localeCompare(rosterDisplayName(b)))
        setStaff(sorted)
        setLoading(false)
      })
  }

  useEffect(load, [currentStoreId])

  // Re-fetch on the way back from a staff member's detail page — Qualified
  // may have just been granted or cancelled there (StaffStudyDetail.jsx),
  // so this list's own Qualified badge needs to pick that up too.
  if (selected) {
    return (
      <StaffStudyDetail
        staff={selected}
        onBack={() => {
          setSelected(null)
          load()
        }}
      />
    )
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Learning Tracker</h1>
      <p className="mb-4 text-sm text-gray-500">Study log progress and quiz history for staff at this store.</p>

      {loading ? (
        <LoadingSpinner />
      ) : !staff.length ? (
        <EmptyState label="No staff at this store yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="flex items-center gap-2 font-medium text-gray-800">
                {rosterDisplayName(s)}
                {s.qualified && <Badge color="green">Qualified</Badge>}
              </span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
