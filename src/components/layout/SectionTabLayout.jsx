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
// Jeff, 2026-10-21 (mobile nav redesign, level 2): "手機版的主分頁下常常會有
// 5-7個子分頁...如果現在有按鈕的方式也可以顯示提示訊息...按鈕比較清楚看到所有
// 子分頁，而且分頁內容也可以省掉tab的空間" — replaces the old mobile
// pill-row/dropdown (2026-10-19's DROPDOWN_THRESHOLD, now gone) with a
// single-line back-bar to a button-card chooser screen at this section's
// own bare path (SectionSubpageHome), mirroring MobileSectionHome.jsx one
// level down. Desktop is untouched: the pill row below always shows every
// page at once, exactly as before, regardless of tab count.
//
// A PAGE_GROUPS entry that owns its OWN nested layout (today: Shop
// Management's "Training Centre", via TrainingCentreLayout) gets its own
// back-bar for its own subtree instead of this one stacking on top of it —
// Jeff: "為什麼一定要顯示shop management?...在所有第二層子分頁按紐頁再顯示
// shop management" — exactly one back-bar is ever on screen, always
// pointing one level up from wherever you are. GROUP_SUBPAGE names which
// chooser path such a group's own card should link to (instead of jumping
// straight to its first member page, which is what the desktop pill still
// does); `nestedPaths` (derived from it below) is every path — the group's
// member pages AND its own chooser — that this layout steps aside for
// because a more specific layout already covers them.
const GROUP_SUBPAGE = {
  training_centre: '/shop-management/training-centre',
}

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
  // Jeff, 2026-10-20 (point 7): "分頁按鈕右上角要顯示數字提示" — the same
  // "something's new" signals Sidebar.jsx already showed on the desktop
  // page list (see navBadges.jsx), now on each tab/card here too. auditPending
  // isn't part of AuthContext itself — see useAuditPending.js (this hook is
  // always called, even outside the Audit section; it internally no-ops
  // for every role but shop_manager viewing audit.review).
  const auditPending = useAuditPending(profile, effectivePages)
  const signals = { rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies, auditPending }

  const tabs = logicalPageEntries(sectionKey, sidebarOrder)
    .map((entry) => {
      if (entry.type === 'group') {
        const accessibleMembers = entry.pages.filter((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`))
        if (!accessibleMembers.length) return null
        const memberPaths = accessibleMembers.map((p) => `${prefix}/${p.replace(/_/g, '-')}`)
        const subpageTo = GROUP_SUBPAGE[entry.key]
        return {
          key: entry.key,
          label: entry.label,
          to: memberPaths[0],
          subpageTo,
          matchPaths: subpageTo ? [...memberPaths, subpageTo] : memberPaths,
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

  // Every path a nested group's own layout already owns a back-bar for —
  // this layout's back-bar steps aside on all of them (see comment above).
  const nestedPaths = tabs.filter((t) => t.subpageTo).flatMap((t) => t.matchPaths)
  const showBackBar = pathname !== prefix && !nestedPaths.includes(pathname)

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

      {/* Mobile: a slim back-bar instead of a tab bar — the button-card
          chooser at this section's own bare path (SectionSubpageHome, via
          the Outlet context below) shows every page; this bar is just the
          way back up to it. Hidden on the chooser page itself, and hidden
          under a nested group's own subtree so exactly one back-bar is ever
          on screen (see GROUP_SUBPAGE/nestedPaths above). */}
      {showBackBar && (
        <Link to={prefix} className="mb-4 flex items-center gap-1 text-sm font-medium text-brand-600 md:hidden">
          <span aria-hidden>‹</span> {section?.label}
        </Link>
      )}

      <Outlet
        context={{
          items: tabs.map((t) => ({ key: t.key, label: t.label, to: t.subpageTo ?? t.to, badge: t.badge })),
          firstPath: tabs[0]?.to,
        }}
      />
    </div>
  )
}
