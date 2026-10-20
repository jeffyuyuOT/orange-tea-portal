import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { SECTIONS, canAccessPage } from '../../lib/permissions'
import { supabase } from '../../lib/supabaseClient'
import { currentTitle } from '../../lib/trainingJourney'
import { badgeForKeys } from '../../lib/navBadges'
import NavBadge from '../../components/ui/NavBadge'

const TABS = [
  { key: 'dashboard.bulletin', to: '/dashboard/bulletin', label: 'Bulletin Board' },
  { key: 'dashboard.message', to: '/dashboard/message', label: 'Message' },
  { key: 'dashboard.study_log', to: '/dashboard/study-log', label: 'Study Log' },
  // Jeff, 2026-10-21: back to the full label — the old mobile tab row this
  // was shortened for (2026-10-21) is gone, replaced by a button-card
  // chooser + a one-line back-bar (mobile nav redesign, level 2). Desktop's
  // pill row below had the room for the full label all along.
  { key: 'dashboard.time_attendance', to: '/dashboard/time-attendance', label: 'Time & Attendance' },
  { key: 'dashboard.my_information', to: '/dashboard/my-information', label: 'My Information' },
]

export default function DashboardLayout() {
  const { profile, effectivePages, unreadMessageCount, hasBulletinUpdates } = useAuth()
  const { pathname } = useLocation()
  // Jeff, 2026-10-20 (point 7): same "something's new" lookup the new
  // mobile nav surfaces use (navBadges.jsx) — brings this tab bar's Message
  // count up to parity with a Bulletin Board dot too (Sidebar.jsx already
  // showed one next to Bulletin; this tab bar only ever had Message's).
  const navSignals = { hasBulletinUpdates, unreadMessageCount }

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
  // Jeff, 2026-10-07 (8-point phase-merge request, point 1): Master now
  // reads as Phase 4's own color (the merged Expert tier no longer exists
  // as a separate color/icon), with 👑 next to the title — same icon used
  // on the roster.
  const title = phases.length ? currentTitle(profile, phases) : null
  const titlePhaseNumber = profile?.has_master_title ? 4 : profile?.training_journey_phase ?? 0
  const titleColor = phases.find((p) => p.phase_number === titlePhaseNumber)?.text_color

  const accessibleTabs = TABS.filter((t) => canAccessPage(effectivePages, t.key))
  // Jeff, 2026-10-21 (follow-up): "員工預設進去app會直接進clock in/out頁面，
  // 這樣會不容易看到其他分頁有提示...在返回的圖示上加小紅點" — staff land
  // straight on Time & Attendance (see AppShell.jsx's sign-in redirect), so
  // this back-bar is the first thing they'd see with something new in
  // another Dashboard page — same aggregate-badge reasoning as
  // SectionTabLayout.jsx's own back-bar.
  const anyBadge = badgeForKeys(accessibleTabs.map((t) => t.key), navSignals)

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
            ({profile?.has_master_title ? <span aria-hidden>👑 </span> : null}
            {title})
          </span>
        )}
      </h1>

      {/* Desktop: unchanged pill row, every page at once. */}
      <div className="mb-5 hidden flex-wrap gap-1 border-b border-brand-100 md:flex">
        {accessibleTabs.map((t) => (
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
            {/* Jeff, 2026-09: circled unread count for Message (not just a
                dot — see AuthContext.jsx's unreadMessageCount), a plain dot
                for Bulletin Board — same badgeForKeys lookup every nav
                surface now shares (navBadges.jsx). */}
            <NavBadge badge={badgeForKeys([t.key], navSignals)} />
          </NavLink>
        ))}
      </div>

      {/* Jeff, 2026-10-21 (mobile nav redesign, level 2): a slim back-bar
          instead of the old mobile tab row — hidden on the chooser page
          itself ("/dashboard", SectionSubpageHome via the Outlet context
          below), same pattern every other section's layout now uses
          (SectionTabLayout.jsx). */}
      {pathname !== '/dashboard' && (
        <Link to="/dashboard" className="mb-4 flex items-center gap-1 text-sm font-medium text-brand-600 md:hidden">
          <span aria-hidden>‹</span> {SECTIONS.dashboard?.label}
          <NavBadge badge={anyBadge} />
        </Link>
      )}

      <Outlet
        context={{
          items: accessibleTabs.map((t) => ({ key: t.key, label: t.label, to: t.to, badge: badgeForKeys([t.key], navSignals) })),
          firstPath: accessibleTabs[0]?.to,
        }}
      />
    </div>
  )
}
