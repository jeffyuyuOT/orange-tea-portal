import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import RosterWeekTable from '../shared/RosterWeekTable'
import { fetchSubmittedPeriod, thisWeekStart, nextWeekStart } from '../shared/rosterWeeks'

export default function MyRosterPage() {
  const { currentStoreId, profile, refreshRosterUpdates } = useAuth()
  const [thisWeek, setThisWeek] = useState(null)
  const [nextWeek, setNextWeek] = useState(null)

  useEffect(() => {
    if (!currentStoreId) return
    fetchSubmittedPeriod(currentStoreId, thisWeekStart()).then(setThisWeek)
    fetchSubmittedPeriod(currentStoreId, nextWeekStart()).then(setNextWeek)
  }, [currentStoreId])

  // Opening this page is "having looked at it" — clears the "Update" badge
  // on the My Roster sidebar link (see migration 0047) for this store, no
  // extra confirmation step needed.
  useEffect(() => {
    if (!currentStoreId || !profile?.id) return
    supabase
      .from('roster_view_state')
      .upsert(
        { profile_id: profile.id, store_id: currentStoreId, my_roster_viewed_at: new Date().toISOString() },
        { onConflict: 'profile_id,store_id' }
      )
      .then(() => refreshRosterUpdates())
  }, [currentStoreId, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">My Roster</h1>
      <p className="mb-4 text-sm text-gray-500">Your shifts for this week, and next week once published.</p>

      <div className="space-y-6">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">This Week</h3>
          <RosterWeekTable period={thisWeek} onlyProfileId={profile?.id} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Next Week</h3>
          <RosterWeekTable period={nextWeek} onlyProfileId={profile?.id} />
        </div>
      </div>
    </div>
  )
}
