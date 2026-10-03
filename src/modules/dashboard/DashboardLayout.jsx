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
  // Journey title shown right next to the greeting. Phases barely ever
  // change, so fetched once here rather than threaded through AuthContext.
  //
  // Jeff, 2026-10-03: "為什麼jeff test的my dashboard名字後面沒有顯示title，
  // 是因為是trainee的關係嗎，trainee也要顯示" — yes, "Trainee" (phase 0) used
  // to be deliberately hidden here; now it shows like every other title.
  // Same request's other half: "my dashboard名字後面的title也要跟著phase的
  // 顏色" — matches the same color treatment Learning Tracker's title just
  // got: that phase's own admin-configured text_color (Phase Setting),
  // Master reading as Phase 6's color. Phase 0/Trainee has no phase row to
  // match (phases are only seeded 1-6), so it falls back to the plain gray
  // this whole badge used to be.
  const [phases, setPhases] = useState([])
  useEffect(() => {
    supabase
      .from('training_journey_phases')
      .select('*')
      .then(({ data }) => setPhases(data ?? []))
  }, [])
  // Jeff, 2026-10-03 (Expert/Master split, point 4): Master now reads as
  // Phase 7's color (was Phase 6, before the split), Expert reads as Phase
  // 6's own color, and both get an icon next to the title — 👑 for Master,
  // 🏅 for Expert — same icons used on the roster.
  const title = phases.length ? currentTitle(profile, phases) : null
  const titlePhaseNumber = profile?.has_master_title ? 7 : profile?.has_expert_title ? 6 : profile?.training_journey_phase ?? 0
  const titleColor = phases.find((p) => p.phase_number === titlePhaseNumber)?.text_color

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        Hi {profile?.first_name || profile?.email}
        <span aria-hidden> 👋</span>
        {title && (
          <span
            className={`ml-2 align-middle text-sm font-medium ${titleColor ? '' : 'text-gray-400'}`}
            style={titleColor ? { color: titleColor } : undefined}
          >
            ({profile?.has_master_title ? <span aria-hidden>👑 </span> : profile?.has_expert_title ? <span aria-hidden>🏅 </span> : null}
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
