import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar, { SidebarBrand, SidebarNavLinks } from './Sidebar'
import StoreSwitcher from './StoreSwitcher'
import { useAuth } from '../../lib/AuthContext'
import { ROLE_LABELS, canAccessPage } from '../../lib/permissions'
import { useClockInOut } from '../../lib/useClockInOut'
import QrScannerModal from '../../modules/dashboard/time-attendance/QrScannerModal'

export default function AppShell() {
  const { profile, effectivePages, accessibleStores, signOut } = useAuth()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Jeff, 2026-10-01: "手機版的scan to check in按鈕能再做一個快捷鍵在選擇分店
  // 跟姓名的中間嗎" — a one-tap shortcut in the header itself, reachable from
  // ANY page, not just after navigating into My Dashboard > Time & Attendance
  // first. Shares its state machine with that page's own Clock In/Out tab via
  // useClockInOut (src/lib/useClockInOut.js) so the two can't drift apart.
  // Hidden for a role that can't reach Time & Attendance at all (e.g.
  // qr_code_maker, accountant) — same permission key the page itself is
  // guarded by (routes.jsx).
  const canClockInOut = canAccessPage(effectivePages, 'dashboard.time_attendance')
  const clockInOut = useClockInOut(profile?.id, accessibleStores)
  // Same "nothing to navigate between" check as Sidebar.jsx (see its
  // 2026-10-01 comment) — hides the hamburger button and drawer too, not
  // just the desktop <aside>, for a role resolved down to one page.
  const hasSidebar = effectivePages.size > 1
  // Admin Center pages (Formula Database, Store Management, User Management,
  // ...) manage every store's data at once — there's nothing to "switch"
  // into, so the per-store picker is hidden there instead of implying a
  // scope that doesn't apply. Developer Tools (currently just Payroll) is
  // the same — that app has its own separate notion of "store" entirely
  // unrelated to OT Portal's stores, so the switcher would be misleading
  // there too.
  const isAdminCenter = location.pathname.startsWith('/admin-center') || location.pathname.startsWith('/developer-tools')

  // Below the sidebar's md breakpoint there was previously no way at all to
  // reach anything but whatever page you landed on — the sidebar (and every
  // link in it) was simply `hidden` with no phone-sized replacement. This
  // hamburger + slide-out drawer covers that, reusing the exact same
  // permission-filtered link list as the desktop sidebar.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  // The header shortcut's toast (below) has no fixed spot on the page to
  // stay pinned to like TimeAttendancePage's own inline feedback line does,
  // so it clears itself instead — long enough to read a short line, same
  // idea as the "red dot" Sidebar badges that don't require a click to
  // dismiss either.
  useEffect(() => {
    if (!clockInOut.feedback) return
    const timer = setTimeout(() => clockInOut.setFeedback(null), 4000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockInOut.feedback])

  return (
    <div className="flex h-screen w-full bg-white">
      <Sidebar />

      {hasSidebar && mobileNavOpen && (
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
            {hasSidebar && (
              <button
                onClick={() => setMobileNavOpen(true)}
                className="shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 md:hidden"
                aria-label="Open menu"
              >
                ☰
              </button>
            )}
            {isAdminCenter ? <span className="text-sm font-medium text-brand-700">All Stores</span> : <StoreSwitcher />}
          </div>
          {canClockInOut && (
            <button
              onClick={clockInOut.openScanner}
              className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 p-1.5 text-lg leading-none text-brand-600 hover:bg-brand-100 md:hidden"
              aria-label={`Scan to ${clockInOut.isClockedIn ? 'Clock Out' : 'Clock In'}`}
              title={`Scan to ${clockInOut.isClockedIn ? 'Clock Out' : 'Clock In'}`}
            >
              📷
            </button>
          )}
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

      {canClockInOut && clockInOut.showScanner && (
        <QrScannerModal onScan={clockInOut.handleScan} onClose={clockInOut.closeScanner} />
      )}
      {/* The header button can be tapped from any page, so its result can't
          rely on a fixed spot in that page's own layout the way
          TimeAttendancePage's inline feedback line does — this floats above
          everything instead and clears itself after a few seconds. */}
      {canClockInOut && clockInOut.feedback && (
        <div className="fixed left-1/2 top-16 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 md:hidden">
          <div
            className={`rounded-lg border px-3 py-2 text-center text-sm shadow-lg ${
              clockInOut.feedback.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {clockInOut.feedback.text}
          </div>
        </div>
      )}
    </div>
  )
}
