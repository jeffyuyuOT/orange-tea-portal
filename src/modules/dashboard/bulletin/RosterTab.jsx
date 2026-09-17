import { useEffect, useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import RosterWeekTable from '../../roster-hub/shared/RosterWeekTable'
import { fetchSubmittedPeriod, thisWeekStart, nextWeekStart } from '../../roster-hub/shared/rosterWeeks'

export default function RosterTab() {
  const { currentStoreId } = useAuth()
  const [thisWeek, setThisWeek] = useState(null)
  const [nextWeek, setNextWeek] = useState(null)

  useEffect(() => {
    if (!currentStoreId) return
    fetchSubmittedPeriod(currentStoreId, thisWeekStart()).then(setThisWeek)
    fetchSubmittedPeriod(currentStoreId, nextWeekStart()).then(setNextWeek)
  }, [currentStoreId])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">This Week</h3>
        <RosterWeekTable period={thisWeek} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Next Week</h3>
        <RosterWeekTable period={nextWeek} />
      </div>
    </div>
  )
}
