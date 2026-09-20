import { NavLink } from 'react-router-dom'
import { SECTIONS, canAccessSection, canAccessPage } from '../../lib/permissions'
import { useAuth } from '../../lib/AuthContext'

// The link list itself, shared between the permanent desktop sidebar below
// and the slide-out mobile drawer (AppShell) — one place decides which
// sections/pages a role can see, so the two never disagree. `onNavigate`
// closes the mobile drawer after a tap; the desktop sidebar doesn't need it.
export function SidebarNavLinks({ onNavigate }) {
  const { effectivePages } = useAuth()

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
      {Object.entries(SECTIONS).map(([sectionKey, section]) => {
        if (!canAccessSection(effectivePages, sectionKey)) return null
        return (
          <div key={sectionKey}>
            <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-brand-400">{section.label}</div>
            <div className="space-y-0.5">
              {Object.entries(section.pages).map(([pageKey, pageLabel]) => {
                const fullKey = `${sectionKey}.${pageKey}`
                if (!canAccessPage(effectivePages, fullKey)) return null
                return (
                  <NavLink
                    key={fullKey}
                    to={`/${sectionKey.replace(/_/g, '-')}/${pageKey.replace(/_/g, '-')}`}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-1.5 text-sm ${
                        isActive ? 'bg-brand-500 text-white font-medium' : 'text-gray-600 hover:bg-brand-100 hover:text-brand-800'
                      }`
                    }
                  >
                    {pageLabel}
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
