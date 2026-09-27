import { NavLink } from 'react-router-dom'
import { canAccessSection, canAccessPage } from '../../lib/permissions'
import { orderedSectionEntries, orderedPageEntries } from '../../lib/sidebarOrder'
import { useAuth } from '../../lib/AuthContext'
import Badge from '../ui/Badge'

// The link list itself, shared between the permanent desktop sidebar below
// and the slide-out mobile drawer (AppShell) — one place decides which
// sections/pages a role can see, so the two never disagree. `onNavigate`
// closes the mobile drawer after a tap; the desktop sidebar doesn't need it.
// Section/page ORDER (as opposed to which ones a role can see at all) comes
// from `sidebarOrder` (migration 0055) — a shared, admin-editable order set
// in Admin Center > System Setting, rather than SECTIONS' own literal order
// in permissions.js.
export function SidebarNavLinks({ onNavigate }) {
  const { effectivePages, rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, sidebarOrder } = useAuth()

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
      {orderedSectionEntries(sidebarOrder).map(([sectionKey, section]) => {
        if (!canAccessSection(effectivePages, sectionKey)) return null
        return (
          <div key={sectionKey}>
            <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-brand-400">{section.label}</div>
            <div className="space-y-0.5">
              {orderedPageEntries(sectionKey, sidebarOrder).map(([pageKey, pageLabel]) => {
                const fullKey = `${sectionKey}.${pageKey}`
                if (!canAccessPage(effectivePages, fullKey)) return null
                return (
                  <NavLink
                    key={fullKey}
                    to={`/${sectionKey.replace(/_/g, '-')}/${pageKey.replace(/_/g, '-')}`}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                        isActive ? 'bg-brand-500 text-white font-medium' : 'text-gray-600 hover:bg-brand-100 hover:text-brand-800'
                      }`
                    }
                  >
                    {pageLabel}
                    {/* Someone's shift changed on this store's roster since
                        this person last opened My Roster — see migration
                        0047. Only ever shown on their own "My Roster" link,
                        never someone else's. */}
                    {fullKey === 'roster_hub.my_roster' && rosterUpdates.myRoster && <Badge color="red">Update</Badge>}
                    {/* A formula item visible at this store is new or has
                        been edited since this person last opened it — see
                        migration 0053. */}
                    {fullKey === 'operations_training.formula' && hasFormulaUpdates && <Badge color="red">Update</Badge>}
                    {/* Jeff (2026-09): a small dot rather than an "Update"
                        pill like the two above — Bulletin covers three
                        different feeds at once (announcements, customer
                        complaints, roster postings) and no single word
                        summarizes all three, so this just says "something's
                        here" the same way the dots on Bulletin's own inner
                        tabs already do (see BulletinPage.jsx) — this is that
                        same signal, one level up, on the Sidebar entry that
                        leads there. See AuthContext.jsx's hasBulletinUpdates. */}
                    {fullKey === 'dashboard.bulletin' && hasBulletinUpdates && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-label="Update" />
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

export function SidebarBrand() {
  return (
    <div className="flex items-center gap-2 px-5 py-4">
      <img src="/logo-icon.png" alt="Orange Tea AU" className="h-9 w-9 shrink-0 object-contain" />
      <div>
        <div className="text-sm font-semibold text-brand-900">Orange Tea AU</div>
        <div className="text-xs text-brand-500">Staff Portal</div>
      </div>
    </div>
  )
}

// Permanent sidebar for wide screens. Below the `md` breakpoint this is
// hidden entirely — AppShell's hamburger + MobileNavDrawer cover phones,
// reusing the same SidebarNavLinks so both surfaces show the same menu.
export default function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-brand-100 bg-brand-50/40 md:flex md:flex-col">
      <SidebarBrand />
      <SidebarNavLinks />
    </aside>
  )
}
