import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar, { SidebarBrand, SidebarNavLinks } from './Sidebar'
import StoreSwitcher from './StoreSwitcher'
import { useAuth } from '../../lib/AuthContext'
import { ROLE_LABELS } from '../../lib/permissions'

export default function AppShell() {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Admin Center pages (Formula Database, Store Management, User Management,
  // ...) manage every store's data at once — there's nothing to "switch"
  // into, so the per-store picker is hidden there instead of implying a
  // scope that doesn't apply.
  const isAdminCenter = location.pathname.startsWith('/admin-center')

  // Below the sidebar's md breakpoint there was previously no way at all to
  // reach anything but whatever page you landed on — the sidebar (and every
  // link in it) was simply `hidden` with no phone-sized replacement. This
  // hamburger + slide-out drawer covers that, reusing the exact same
  // permission-filtered link list as the desktop sidebar.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  return (
    <div className="flex h-screen w-full bg-white">
      <Sidebar />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <div className="relative flex w-64 max-w-[80vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-brand-100 pr-2">
              <SidebarBrand />
              <button
                onClick={() => setMobileNavOpen(false)}
                className="rounded-full p-1 text-gray-400 hover:bg-brand-50 hover:text-brand-600"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <SidebarNavLinks onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-brand-100 px-3 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 md:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            {isAdminCenter ? <span className="text-sm font-medium text-brand-700">All Stores</span> : <StoreSwitcher />}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-gray-800">
                {profile?.first_name ? `${profile.first_name} ${profile.last_name ?? ''}` : profile?.email}
              </div>
              <div className="text-xs text-brand-500">{ROLE_LABELS[profile?.role] ?? profile?.role}</div>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </header>
        {/* overflow-x-hidden here is a safety net: if some element inside a
            page is ever too wide for the screen (like the Study Log header
            row Jeff hit on mobile, before it got its own flex-wrap fix),
            this stops the whole content pane from turning into a
            horizontal-scroll page — where scrolling to see the overflowing
            thing also drags everything else out of view — and instead just
            clips the offending element in place, which is a much easier bug
            to spot and report. Anything that legitimately needs to scroll
            sideways (the Progress Chart's SVG, wide tables) already wraps
            itself in its own overflow-x-auto container, so this doesn't
            affect those. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
