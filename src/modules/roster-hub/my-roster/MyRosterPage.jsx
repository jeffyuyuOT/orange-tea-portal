import { useEffect, useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import RosterWeekTable from '../shared/RosterWeekTable'
import { fetchSubmittedPeriod, thisWeekStart, nextWeekStart } from '../shared/rosterWeeks'

export default function MyRosterPage() {
  const { currentStoreId, profile } = useAuth()
  const [thisWeek, setThisWeek] = useState(null)
  const [nextWeek, setNextWeek] = useState(null)

  useEffect(() => {
    if (!currentStoreId) return
    fetchSubmittedPeriod(currentStoreId, thisWeekStart()).then(setThisWeek)
    fetchSubmittedPeriod(currentStoreId, nextWeekStart()).then(setNextWeek)
  }, [currentStoreId])

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
