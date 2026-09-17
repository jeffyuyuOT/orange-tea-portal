import { useState } from 'react'
import RosterTab from './RosterTab'
import AnnouncementsTab from './AnnouncementsTab'

const SUBTABS = [
  { key: 'roster', label: 'Roster' },
  { key: 'announcements', label: 'Store Announcement' },
]

export default function BulletinPage() {
  const [tab, setTab] = useState('roster')

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roster' ? <RosterTab /> : <AnnouncementsTab />}
    </div>
  )
}
