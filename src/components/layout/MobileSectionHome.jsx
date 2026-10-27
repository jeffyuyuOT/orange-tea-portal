import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { SECTIONS, canAccessPage } from '../../lib/permissions'
import { orderedSectionEntries, logicalPageEntries } from '../../lib/sidebarOrder'
import { useAuditPending } from '../../lib/useAuditPending'
import { badgeForKeys } from '../../lib/navBadges'
import { SECTION_STYLE } from '../../lib/sectionStyle'
import NavBadge from '../ui/NavBadge'
import NavTreeModal from './NavTreeModal'

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
// Jeff, 2026-10-21: the color/icon recipe itself moved to lib/sectionStyle.js
// (imported above) so SectionSubpageHome.jsx — the same button-card recipe,
// one level down — can reuse it without breaking Fast Refresh here.

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
  const { effectivePages, sidebarOrder, profile, rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies } =
    useAuth()
  // Jeff, 2026-10-20 (point 7): "分頁按鈕右上角要顯示數字提示，這樣user才知道
  // 裡面有提示訊息要按進去看" — a section block here is the FIRST tap on
  // mobile, so it needs its own "something in here" badge just as much as
  // the per-page tabs do (SectionTabLayout) — otherwise there's no way to
  // know a section has an update without opening it first. See
  // navBadges.jsx for the shared lookup every nav surface uses.
  const auditPending = useAuditPending(profile, effectivePages)
  const signals = { rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies, auditPending }
  // Jeff, 2026-10-27: "手機版分頁按鈕最下方新增一個樹狀圖的圖案" — one more
  // tile at the END of this grid (see the render below), opening
  // NavTreeModal instead of navigating anywhere.
  const [showTree, setShowTree] = useState(false)

  const sections = orderedSectionEntries(sidebarOrder)
    .map(([sectionKey]) => {
      const entries = logicalPageEntries(sectionKey, sidebarOrder)
      const reachable = entries.filter((e) =>
        e.type === 'group'
          ? e.pages.some((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`))
          : canAccessPage(effectivePages, `${sectionKey}.${e.key}`)
      )
      if (!reachable.length) return null
      const fullKeys = reachable.flatMap((e) =>
        e.type === 'group'
          ? e.pages.filter((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`)).map((p) => `${sectionKey}.${p}`)
          : [`${sectionKey}.${e.key}`]
      )
      // Jeff, 2026-10-21 (mobile nav redesign, level 2): a section with more
      // than one reachable page now lands on ITS OWN button-card chooser
      // (SectionSubpageHome, at this section's own bare path) instead of
      // jumping straight into the first page — same reasoning as this
      // screen itself, one level up. A section with exactly one reachable
      // page skips the (otherwise 1-card, pointless) chooser and still
      // links straight to it.
      const prefix = `/${sectionKey.replace(/_/g, '-')}`
      return {
        key: sectionKey,
        label: SECTIONS[sectionKey]?.label ?? sectionKey,
        count: reachable.length,
        to: reachable.length > 1 ? prefix : firstPathInSection(sectionKey, reachable, effectivePages),
        style: SECTION_STYLE[sectionKey],
        badge: badgeForKeys(fullKeys, signals),
      }
    })
    .filter(Boolean)

  // Nobody with fewer than 2 reachable sections ever taps their way here
  // (AppShell's grid-icon button is hidden under the same "nothing to
  // switch to" condition it always used), but a direct link/bookmark to
  // /home should still land somewhere real rather than an empty grid.
  if (sections.length <= 1) return <Navigate to="/" replace />

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {sections.map((s) => (
          <Link
            key={s.key}
            to={s.to}
            className="relative flex min-h-[92px] flex-col rounded-2xl p-4 text-white shadow-sm"
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
            <NavBadge badge={s.badge} corner />
          </Link>
        ))}
        {/* Jeff, 2026-10-27: "手機版分頁按鈕最下方新增一個樹狀圖的圖案，按下
            去會彈出視窗顯示樹狀圖有哪些主分頁，主分頁下有哪些子分頁" — last
            tile in this grid (so it reads as "at the bottom" of the section
            buttons), neutral gray since it isn't a real section — opens
            NavTreeModal instead of navigating. */}
        <button
          type="button"
          onClick={() => setShowTree(true)}
          className="relative flex min-h-[92px] flex-col rounded-2xl p-4 text-left text-white shadow-sm"
          style={{ background: 'linear-gradient(135deg,#9ca3af,#6b7280)' }}
        >
          <span className="text-xl opacity-90" aria-hidden>
            🌳
          </span>
          <div className="mt-auto">
            <div className="text-sm font-semibold leading-snug">Navigation Map</div>
            <div className="text-[11px] opacity-85">View all pages</div>
          </div>
        </button>
      </div>
      <NavTreeModal open={showTree} onClose={() => setShowTree(false)} />
    </>
  )
}
