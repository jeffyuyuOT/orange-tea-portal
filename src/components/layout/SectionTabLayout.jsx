import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { SECTIONS, canAccessPage } from '../../lib/permissions'
import { logicalPageEntries } from '../../lib/sidebarOrder'
import { useAuditPending } from '../../lib/useAuditPending'
import { badgeForKeys } from '../../lib/navBadges'
import NavBadge from '../ui/NavBadge'

// Jeff, 2026-10-19 (mobile nav redesign, point 2): a shared top tab bar +
// <Outlet/> for every multi-page section, generalizing the pattern
// DashboardLayout.jsx/TrainingCentreLayout.jsx already proved for My
// Dashboard/Training Centre — this one component covers the rest (Shop
// Management, Roster Hub, Audit, Admin Center, Operations & Training,
// Developer Tools) instead of six near-identical hand-written files. Lazy
// loading is unaffected either way: this layout (like those two) is itself
// part of the already-loaded route tree, and each tab still routes to its
// own independently lazy-loaded page — only the ACTIVE tab's chunk
// downloads.
//
// Tabs come off the SAME admin-editable Sidebar order (logicalPageEntries,
// sidebarOrder.js) the Sidebar itself renders from, so this can never show
// a different page list/order than the Sidebar does. A PAGE_GROUPS entry
// (e.g. Shop Management's "Training Centre", folding quiz_bank/
// shop_training_database/training_journey_setting into one row) becomes
// ONE tab here too — linking to whichever member page this person can
// reach first, same as Sidebar.jsx's own group row — and that member's own
// route (TrainingCentreLayout) then renders its own separate sub-tab bar
// underneath; the two layouts nest rather than duplicate each other, and
// this tab stays highlighted while on ANY of the group's pages, not just
// the one it happens to link to (same "isActive across every member"
// treatment Sidebar.jsx's own group row already uses).
//
// Jeff, 2026-10-19 (follow-up): "admin在分頁太多的情況，手機上半部幾乎被tab
// 占滿了" — Admin Center's 7 tabs wrapped to 4 rows on a phone before any
// page content even started. Desktop keeps the pill row no matter how many
// tabs (plenty of width there); on mobile, a section with MANY tabs
// (DROPDOWN_THRESHOLD or more) collapses to a one-row dropdown instead —
// confirmed with a mockup (two live versions to compare space used) before
// building this. A section with few tabs (Operations & Training, Audit)
// keeps the same visible pill row on mobile too — nothing to collapse, and
// visible tabs are one tap instead of two. Deliberately NOT horizontal
// scroll: Jeff explicitly moved away from that for TrainingCentreLayout.jsx
// (2026-09-29/2026-10-02, "必须往旁边滑" was the complaint), so a dropdown
// was picked over reviving the swipe pattern here.
const DROPDOWN_THRESHOLD = 5

function pillClass(isActive) {
  return `flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
    isActive ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
  }`
}

export default function SectionTabLayout({ sectionKey }) {
  const { effectivePages, sidebarOrder, profile, rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies } =
    useAuth()
  const { pathname } = useLocation()
  const section = SECTIONS[sectionKey]
  const prefix = `/${sectionKey.replace(/_/g, '-')}`
  const [ddOpen, setDdOpen] = useState(false)
  // Jeff, 2026-10-20 (point 7): "分頁按鈕右上角要顯示數字提示" — the same
  // "something's new" signals Sidebar.jsx already showed on the desktop
  // page list (see navBadges.jsx), now on each tab here too. auditPending
  // isn't part of AuthContext itself — see useAuditPending.js (this hook is
  // always called, even outside the Audit section; it internally no-ops
  // for every role but shop_manager viewing audit.review).
  const auditPending = useAuditPending(profile, effectivePages)
  const signals = { rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies, auditPending }

  useEffect(() => {
    setDdOpen(false)
  }, [pathname])

  const tabs = logicalPageEntries(sectionKey, sidebarOrder)
    .map((entry) => {
      if (entry.type === 'group') {
        const accessibleMembers = entry.pages.filter((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`))
        if (!accessibleMembers.length) return null
        return {
          key: entry.key,
          label: entry.label,
          to: `${prefix}/${accessibleMembers[0].replace(/_/g, '-')}`,
          matchPaths: accessibleMembers.map((p) => `${prefix}/${p.replace(/_/g, '-')}`),
          fullKeys: accessibleMembers.map((p) => `${sectionKey}.${p}`),
        }
      }
      const fullKey = `${sectionKey}.${entry.key}`
      if (!canAccessPage(effectivePages, fullKey)) return null
      const to = `${prefix}/${entry.key.replace(/_/g, '-')}`
      return { key: entry.key, label: entry.label, to, matchPaths: [to], fullKeys: [fullKey] }
    })
    .filter(Boolean)
    .map((t) => ({
      ...t,
      isActive: t.matchPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`)),
      badge: badgeForKeys(t.fullKeys, signals),
    }))

  const activeTab = tabs.find((t) => t.isActive) ?? tabs[0]
  const useDropdownOnMobile = tabs.length >= DROPDOWN_THRESHOLD
  // Aggregate badge for the collapsed dropdown button itself — with the
  // list closed there's no other way to see any one tab's own badge, so
  // the toggle needs its own "something in here" signal (point 7's
  // "這樣user才知道裡面有提示訊息要按進去看").
  const anyBadge = useDropdownOnMobile ? badgeForKeys(tabs.flatMap((t) => t.fullKeys), signals) : null

  function renderPill(t) {
    return (
      <Link key={t.key} to={t.to} className={pillClass(t.isActive)}>
        {t.label}
        <NavBadge badge={t.badge} />
      </Link>
    )
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">{section?.label}</h1>

      {/* Desktop: always the pill row, regardless of tab count — plenty of
          width there, and this matches every other section's existing
          look (DashboardLayout.jsx, TrainingCentreLayout.jsx). */}
      <div className="mb-5 hidden flex-wrap gap-1 border-b border-brand-100 md:flex">{tabs.map(renderPill)}</div>

      {/* Mobile: pills when there's not many, a dropdown once there are —
          see this component's top comment. */}
      {useDropdownOnMobile ? (
        <div className="relative mb-5 md:hidden">
          <button
            type="button"
            onClick={() => setDdOpen((v) => !v)}
            aria-expanded={ddOpen}
            className="relative flex w-full items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-semibold text-brand-700"
          >
            <span className="truncate">{activeTab?.label}</span>
            <span className={`shrink-0 text-xs text-brand-400 transition-transform ${ddOpen ? 'rotate-180' : ''}`} aria-hidden>
              ▾
            </span>
            <NavBadge badge={anyBadge} corner />
          </button>
          {ddOpen && (
            <>
              {/* Click-away target, same pattern AppShell's old mobile
                  drawer used for the same purpose. */}
              <div className="fixed inset-0 z-10" onClick={() => setDdOpen(false)} />
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-brand-100 bg-white shadow-lg">
                {tabs.map((t) => (
                  <Link
                    key={t.key}
                    to={t.to}
                    onClick={() => setDdOpen(false)}
                    className={`flex items-center justify-between gap-2 border-b border-gray-100 px-3.5 py-2.5 text-sm last:border-b-0 ${
                      t.isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600'
                    }`}
                  >
                    {t.label}
                    <NavBadge badge={t.badge} />
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mb-5 flex flex-wrap gap-1 border-b border-brand-100 md:hidden">{tabs.map(renderPill)}</div>
      )}

      <Outlet />
    </div>
  )
}
