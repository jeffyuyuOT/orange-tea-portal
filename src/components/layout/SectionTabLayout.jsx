import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { SECTIONS, canAccessPage } from '../../lib/permissions'
import { logicalPageEntries } from '../../lib/sidebarOrder'

// Jeff, 2026-10-19 (mobile nav redesign, point 2): a shared top tab bar +
// <Outlet/> for every multi-page section, generalizing the pattern
// DashboardLayout.jsx/TrainingCentreLayout.jsx already proved for My
// Dashboard/Training Centre — this one component covers the rest (Shop
// Management, Roster Hub, Audit, Admin Center, Operations & Training)
// instead of five near-identical hand-written files. Lazy loading is
// unaffected either way: this layout (like those two) is itself part of
// the already-loaded route tree, and each tab still routes to its own
// independently lazy-loaded page — only the ACTIVE tab's chunk downloads.
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
export default function SectionTabLayout({ sectionKey }) {
  const { effectivePages, sidebarOrder } = useAuth()
  const { pathname } = useLocation()
  const section = SECTIONS[sectionKey]
  const prefix = `/${sectionKey.replace(/_/g, '-')}`

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
        }
      }
      const fullKey = `${sectionKey}.${entry.key}`
      if (!canAccessPage(effectivePages, fullKey)) return null
      const to = `${prefix}/${entry.key.replace(/_/g, '-')}`
      return { key: entry.key, label: entry.label, to, matchPaths: [to] }
    })
    .filter(Boolean)

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">{section?.label}</h1>
      <div className="mb-5 flex flex-wrap gap-1 border-b border-brand-100">
        {tabs.map((t) => {
          const isActive = t.matchPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))
          return (
            <Link
              key={t.key}
              to={t.to}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
                isActive ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
      <Outlet />
    </div>
  )
}
