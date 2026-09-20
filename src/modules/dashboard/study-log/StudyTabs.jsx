import { useState } from 'react'
import StudyLogList from './StudyLogList'
import QuizHistoryList from './QuizHistoryList'

const TABS = [
  { key: 'log', label: 'Learning & Progress' },
  { key: 'history', label: 'Quiz History' },
]

// Shared tab shell for the two views of one person's study data: "My
// Dashboard > Study Log" (their own) and "Shop Management > Learning
// Tracker" (a manager looking at a staff member's) both render this same
// two-tab layout, just with different props.
//
// `historyRefreshKey` lets a parent (e.g. after a forced quiz completes)
// force Quiz History to refetch. `logExtra` renders extra content under the
// checklist — e.g. the Quick Quiz button, which only makes sense in the
// self view, not when a manager is looking at someone else's log.
export default function StudyTabs({
  profileId,
  allowBulkSelect = false,
  senior = false,
  onProgressChange,
  historyRefreshKey,
  logExtra,
}) {
  const [tab, setTab] = useState('log')

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-brand-100">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'log' ? (
        <>
          <StudyLogList
            profileId={profileId}
            allowBulkSelect={allowBulkSelect}
            senior={senior}
            onProgressChange={onProgressChange}
          />
          {logExtra}
        </>
      ) : (
        <QuizHistoryList profileId={profileId} refreshKey={historyRefreshKey} />
      )}
    </div>
  )
}
