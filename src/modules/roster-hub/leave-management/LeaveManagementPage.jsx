import { useState } from 'react'
import ApplyLeaveTab from './ApplyLeaveTab'
import EditLeaveTab from './EditLeaveTab'
import LeaveScheduleTab from './LeaveScheduleTab'

const TABS = [
  { key: 'apply', label: 'Apply Leave' },
  { key: 'edit', label: 'Edit Leave' },
  { key: 'schedule', label: 'Leave Schedule' },
]

export default function LeaveManagementPage() {
  const [tab, setTab] = useState('apply')

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Leave Management</h1>
      <div className="mb-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
        {TABS.map((t) => (
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
      {tab === 'apply' && <ApplyLeaveTab />}
      {tab === 'edit' && <EditLeaveTab />}
      {tab === 'schedule' && <LeaveScheduleTab />}
    </div>
  )
}
