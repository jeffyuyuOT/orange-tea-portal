import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar, { SidebarBrand, SidebarNavLinks } from './Sidebar'
import StoreSwitcher from './StoreSwitcher'
import { useAuth } from '../../lib/AuthContext'
import { ROLE_LABELS, canAccessPage } from '../../lib/permissions'
import { useClockInOut } from '../../lib/useClockInOut'
import QrScannerModal from '../../modules/dashboard/time-attendance/QrScannerModal'
import ClockFeedbackModal from '../../modules/dashboard/time-attendance/ClockFeedbackModal'
import Modal from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'

export default function AppShell() {
  const {
    profile,
    effectivePages,
    accessibleStores,
    signOut,
    unreadMessageCount,
    rosterUpdates,
    hasFormulaUpdates,
    hasBulletinUpdates,
    refreshProfile,
  } = useAuth()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Jeff, 2026-10-02: "桌面捷徑有辦法有訊息提示嗎" — a badge/dot on the
  // installed-app icon itself (desktop taskbar / Android home screen). This
  // is the Badging API (navigator.setAppBadge / clearAppBadge) — NOT real
  // push notifications (a popup alert when the app isn't even open), which
  // would need a service worker push handler, VAPID keys and a backend
  // trigger this project doesn't have. Badging only works on an installed
  // PWA icon, and only on Chrome/Edge-family browsers (desktop + Android) —
  // iOS has no equivalent for a home-screen web app, same platform gap as
  // the 2026-10-01 "shortcuts" discussion. `'setAppBadge' in navigator`
  // guards every other browser/OS combo (a normal browser tab, Safari,
  // etc.) to a harmless no-op.
  //
  // Jeff, 2026-10-02 (later): "改成紅底加數字...提示除了之前說的new
  // message，還包括my roster更新，formula update，跟bulletin的新提示消息"
  // — originally just unreadMessageCount, now the sum of four Sidebar-dot
  // signals already tracked in AuthContext: unreadMessageCount is a real
  // count (one per unread message), while rosterUpdates.myRoster/
  // hasFormulaUpdates/hasBulletinUpdates are each a plain "something's
  // unread here" boolean under the current data model (no per-item count
  // exists for those three yet), so each contributes at most 1 toward the
  // total rather than the exact number of unread items within it. Staff
  // Time Logs' own red dot (hasTimeDiscrepancies) is deliberately NOT
  // included here, per Jeff: "有edit attendance logs權限的人在staff time
  // logs的提示不用算在這裡" — it's a manager-facing review flag, not a
  // personal "something of yours needs attention" signal like the four
  // above.
  const badgeCount =
    unreadMessageCount + (rosterUpdates.myRoster ? 1 : 0) + (hasFormulaUpdates ? 1 : 0) + (hasBulletinUpdates ? 1 : 0)
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    if (badgeCount > 0) {
      navigator.setAppBadge(badgeCount).catch(() => {})
    } else {
      navigator.clearAppBadge().catch(() => {})
    }
  }, [badgeCount])
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

  // Jeff, 2026-10-08: "被qualified的員工，登入系統時中間會跳出視窗顯示
  // Congratulations! You have officially qualified as an Advanced staff
  // member." — a one-time congratulations popup, shown the next time a
  // newly-Qualified staff member logs in (not immediately after passing the
  // Formal Exam itself — that modal's result screen is unaffected). Unseen
  // whenever qualified_popup_seen_at is missing or older than qualified_at,
  // mirroring the title_loss popup's seen/at pair below it — so a staff
  // member who loses and later re-earns the title (disqualify -> recover via
  // Level-Up Exam) sees this again too, since recovering stamps a fresh
  // qualified_at.
  const showQualifiedPopup =
    !!profile?.qualified &&
    !!profile.qualified_at &&
    (!profile.qualified_popup_seen_at || profile.qualified_popup_seen_at < profile.qualified_at)
  const dismissQualifiedPopup = async () => {
    if (profile?.id) {
      await supabase.from('profiles').update({ qualified_popup_seen_at: new Date().toISOString() }).eq('id', profile.id)
    }
    refreshProfile?.()
  }

  return (
    <div className="flex h-screen w-full flex-col bg-white">
      {/* Jeff, 2026-10-02: "有的apple手機左上角的三條線會在太邊邊按不到，感
          覺上面的橘色區域沒有顯示" — this app runs full-screen on an
          installed iOS home-screen icon (apple-mobile-web-app-capable +
          status-bar-style black-translucent in index.html), which means
          iOS draws its status bar as a transparent OVERLAY on top of this
          page rather than reserving real space for it — without this strip,
          page content (notably the ☰ button below) started flush at y=0,
          right under/behind the status bar and the curved corner/notch,
          which is both why there was no visible orange up there (nothing
          painted that region) and why the ☰ button sat too close to the
          corner to reliably tap. `env(safe-area-inset-top)` (enabled by
          index.html's `viewport-fit=cover`) is the exact height iOS reports
          for that overlay region — 0 everywhere else (desktop, Android, a
          normal Safari tab), so this is invisible outside the installed-
          icon case it's fixing. */}
      <div className="shrink-0 bg-brand-500" style={{ height: 'env(safe-area-inset-top, 0px)' }} />
      <div className="flex min-h-0 flex-1">
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
              // Jeff, 2026-10-02: disabled while a result modal (below) is
              // still up for the same "can't scan again until the previous
              // result is dismissed" reason as TimeAttendancePage's own Scan
              // button — see ClockFeedbackModal's comment.
              <button
                onClick={clockInOut.openScanner}
                disabled={!!clockInOut.feedback}
                className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 p-1.5 text-lg leading-none text-brand-600 hover:bg-brand-100 disabled:opacity-40 md:hidden"
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
      </div>

      {canClockInOut && clockInOut.showScanner && (
        <QrScannerModal onScan={clockInOut.handleScan} onClose={clockInOut.closeScanner} />
      )}
      {/* The header button can be tapped from any page, so its result can't
          rely on a fixed spot in that page's own layout the way
          TimeAttendancePage's inline feedback line used to — same shared
          blocking modal as that page now uses, for the same reason (see
          ClockFeedbackModal's comment): a floating toast that quietly
          cleared itself after a few seconds didn't stop someone from
          tapping 📷 again before they'd even registered the first result. */}
      {canClockInOut && clockInOut.feedback && (
        <ClockFeedbackModal feedback={clockInOut.feedback} onClose={clockInOut.dismissFeedback} />
      )}

      {showQualifiedPopup && (
        <Modal open onClose={dismissQualifiedPopup} title="🎉 Congratulations!">
          <p className="text-sm text-gray-700">You have officially qualified as an Advanced staff member.</p>
          <div className="mt-4 flex justify-end">
            <button
              onClick={dismissQualifiedPopup}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              OK
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
