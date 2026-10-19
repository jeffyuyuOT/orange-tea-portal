import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { SECTIONS, canAccessPage } from '../../lib/permissions'
import { orderedSectionEntries, logicalPageEntries } from '../../lib/sidebarOrder'

// Jeff, 2026-10-19 (mobile nav redesign, point 1): mobile's new main-nav
// screen — one colored button per accessible section, reached via the
// header's grid icon (AppShell.jsx, mobile only — see its 2026-10-19
// comment). Desktop is untouched: its permanent <aside> sidebar (Sidebar.jsx)
// already shows every section/page at once, so it never needs this screen.
//
// This is deliberately NOT a new login landing page — RootRedirect
// (routes.jsx) still sends staff straight to Time & Attendance and every
// other role to their first Sidebar page, exactly as before. This screen is
// only the "go up a level to switch sections" destination: within a
// section you move between its own pages via SectionTabLayout's top tabs;
// crossing to a DIFFERENT section means tapping back to this screen first,
// per Jeff, 2026-10-19 ("要去其他分頁再到上一層").
const SECTION_STYLE = {
  operations_training: { icon: '📖', bg: 'linear-gradient(135deg,#14b8a6,#0d9488)' },
  dashboard: { icon: '🏠', bg: 'linear-gradient(135deg,#fb923c,#f97316)' },
  support: { icon: '🙋', bg: 'linear-gradient(135deg,#64748b,#475569)' },
  shop_management: { icon: '🏪', bg: 'linear-gradient(135deg,#0ea5e9,#0284c7)' },
  roster_hub: { icon: '📅', bg: 'linear-gradient(135deg,#22c55e,#16a34a)' },
  audit: { icon: '📋', bg: 'linear-gradient(135deg,#f43f5e,#e11d48)' },
  admin_center: { icon: '⚙️', bg: 'linear-gradient(135deg,#a855f7,#9333ea)' },
  developer_tools: { icon: '🔧', bg: 'linear-gradient(135deg,#1f2937,#111827)' },
}

// First path this person can reach within one section, in that section's
// own Sidebar order — same logic as sidebarOrder.js's firstAccessiblePagePath,
// just scoped to a single section instead of walking every section.
function firstPathInSection(sectionKey, entries, effectivePages) {
  const prefix = `/${sectionKey.replace(/_/g, '-')}`
  for (const entry of entries) {
    if (entry.type === 'group') {
      const member = entry.pages.find((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`))
      if (member) return `${prefix}/${member.replace(/_/g, '-')}`
    } else if (canAccessPage(effectivePages, `${sectionKey}.${entry.key}`)) {
      return `${prefix}/${entry.key.replace(/_/g, '-')}`
    }
  }
  return prefix
}

export default function MobileSectionHome() {
  const { effectivePages, sidebarOrder } = useAuth()

  const sections = orderedSectionEntries(sidebarOrder)
    .map(([sectionKey]) => {
      const entries = logicalPageEntries(sectionKey, sidebarOrder)
      const reachable = entries.filter((e) =>
        e.type === 'group'
          ? e.pages.some((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`))
          : canAccessPage(effectivePages, `${sectionKey}.${e.key}`)
      )
      if (!reachable.length) return null
      return {
        key: sectionKey,
        label: SECTIONS[sectionKey]?.label ?? sectionKey,
        count: reachable.length,
        to: firstPathInSection(sectionKey, reachable, effectivePages),
        style: SECTION_STYLE[sectionKey],
      }
    })
    .filter(Boolean)

  // Nobody with fewer than 2 reachable sections ever taps their way here
  // (AppShell's grid-icon button is hidden under the same "nothing to
  // switch to" condition it always used), but a direct link/bookmark to
  // /home should still land somewhere real rather than an empty grid.
  if (sections.length <= 1) return <Navigate to="/" replace />

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {sections.map((s) => (
        <Link
          key={s.key}
          to={s.to}
          className="flex min-h-[92px] flex-col rounded-2xl p-4 text-white shadow-sm"
          style={{ background: s.style?.bg ?? 'linear-gradient(135deg,#9ca3af,#6b7280)' }}
        >
          <span className="text-xl opacity-90" aria-hidden>
            {s.style?.icon ?? '📁'}
          </span>
          {/* Jeff, 2026-10-19: the icon used to be absolutely positioned
              over the label ("operation and training的圖示壓到字了") — fine
              for a one-line label, but "Operations & Training" wraps to two
              lines and the bottom-anchored text rose right into the icon's
              fixed spot. Plain flow + mt-auto instead: the icon takes its
              own row, the label block is pushed to the bottom of whatever
              room is left, so a longer/wrapped label just pushes the icon
              up with it rather than overlapping it. */}
          <div className="mt-auto">
            <div className="text-sm font-semibold leading-snug">{s.label}</div>
            <div className="text-[11px] opacity-85">
              {s.count} page{s.count > 1 ? 's' : ''}
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
