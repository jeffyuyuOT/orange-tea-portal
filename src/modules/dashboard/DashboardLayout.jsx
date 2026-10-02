import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { canAccessPage } from '../../lib/permissions'
import { supabase } from '../../lib/supabaseClient'
import { currentTitle } from '../../lib/trainingJourney'
import Badge from '../../components/ui/Badge'

const TABS = [
  { key: 'dashboard.bulletin', to: '/dashboard/bulletin', label: 'Bulletin Board' },
  { key: 'dashboard.message', to: '/dashboard/message', label: 'Message' },
  { key: 'dashboard.study_log', to: '/dashboard/study-log', label: 'Study Log' },
  { key: 'dashboard.time_attendance', to: '/dashboard/time-attendance', label: 'Time & Attendance' },
  { key: 'dashboard.my_information', to: '/dashboard/my-information', label: 'My Information' },
]

export default function DashboardLayout() {
  const { profile, effectivePages, unreadMessageCount } = useAuth()

  // Jeff, 2026-10-02 (Training Journey spec, point 6): the current Training
  // Journey title shown right next to the greeting — "Trainee" (phase 0,
  // nobody's level-up yet) is deliberately NOT shown here, same spirit as
  // the red-name "not yet Qualified" flag never cluttering a brand-new
  // starter's own screen; everyone past that sees their title plainly, with
  // a crown for Master. Phases barely ever change, so fetched once here
  // rather than threaded through AuthContext.
  const [phases, setPhases] = useState([])
  useEffect(() => {
    supabase
      .from('training_journey_phases')
      .select('*')
      .then(({ data }) => setPhases(data ?? []))
  }, [])
  const title = phases.length ? currentTitle(profile, phases) : null
  const showTitle = title && title !== 'Trainee'

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        Hi {profile?.first_name || profile?.email}
        <span aria-hidden> 👋</span>
        {showTitle && (
          <span className="ml-2 align-middle text-sm font-medium text-gray-400">
            ({profile?.has_master_title && <span aria-hidden>👑 </span>}
            {title})
          </span>
        )}
      </h1>

      <div className="mb-5 flex gap-1 border-b border-brand-100">
        {TABS.filter((t) => canAccessPage(effectivePages, t.key)).map((t) => (
          <NavLink
            key={t.key}
            to={t.to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-4 py-2 text-sm font-medium ${
                isActive ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
              }`
            }
          >
            {t.label}
            {/* Jeff, 2026-09: circled unread count, not just a dot — see
                AuthContext.jsx's unreadMessageCount (message_recipients
                with read_at null, across every store, not just the one
                currently switched to — Message is personal scope now). */}
            {t.key === 'dashboard.message' && unreadMessageCount > 0 && <Badge color="red">{unreadMessageCount}</Badge>}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}
