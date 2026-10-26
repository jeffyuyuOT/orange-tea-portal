import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import StoreSwitcher from './StoreSwitcher'
import NavBadge from '../ui/NavBadge'
import { useAuth } from '../../lib/AuthContext'
import { ROLE_LABELS, NON_PICKABLE_STAFF_ROLES, canAccessPage } from '../../lib/permissions'
import { useClockInOut } from '../../lib/useClockInOut'
import { getWorkedMinutesByProfile } from '../../lib/attendance'
import { trainingHoursBandInfo, trainingHoursReminderTitle } from '../../lib/trainingHoursReminder'
import { logicalPageEntries, orderedSectionEntries } from '../../lib/sidebarOrder'
import { useAuditPending } from '../../lib/useAuditPending'
import { badgeForKeys } from '../../lib/navBadges'
import QrScannerModal from '../../modules/dashboard/time-attendance/QrScannerModal'
import ClockFeedbackModal from '../../modules/dashboard/time-attendance/ClockFeedbackModal'
import Modal from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { isIosNonStandalone, isPushSupported, subscribeToPush } from '../../lib/webPush'
import { watchForUpdate, applyUpdate } from '../../lib/swUpdate'

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
    hasTimeDiscrepancies,
    sidebarOrder,
    refreshProfile,
  } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  // Jeff, 2026-10-17: used to redirect front-line staff straight to Time &
  // Attendance right after a real password sign-in (RootRedirect, routes.jsx,
  // only covers landing on "/"). Jeff, 2026-10-21 (follow-up): removed —
  // "不要預設在clock in out的頁面，因為其實最上面有相機快捷" (the header's
  // camera-icon quick-scan button below already covers a fast clock-in/out
  // without a special landing page), and it meant staff could easily sign
  // in and never see an update sitting on their normal first page. See
  // routes.jsx's RootRedirect for the other half of this same revert.
  // Jeff, 2026-10-02: "桌面捷徑有辦法有訊息提示嗎" — a badge/dot on the
  // installed-app icon itself (desktop taskbar / Android home screen) via
  // the Badging API (navigator.setAppBadge / clearAppBadge). Confirmed this
  // session (2026-10-21): Android Chrome doesn't actually implement this API
  // at all — `'setAppBadge' in navigator` is false there, so this effect is
  // a silent no-op on every Android phone and only ever did anything on
  // desktop Chrome/Edge. iOS has no equivalent for a home-screen web app
  // either, same platform gap as the 2026-10-01 "shortcuts" discussion.
  // `'setAppBadge' in navigator` guards every unsupported browser/OS combo
  // to a harmless no-op.
  //
  // Android's own icon badge instead comes entirely from real Web Push
  // (lib/webPush.js, public/push-sw.js, added 2026-10-21) — the OS badges
  // the icon whenever there's an active notification `showNotification()`
  // left in the notification shade, a completely separate mechanism from
  // this Badging API code and from anything tracked in AuthContext. See the
  // "clear shown push notifications" effect further down, which is what
  // actually clears THAT badge.
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
  // Jeff, 2026-10-21 (follow-up): "員工預設進去app會直接進clock in/out頁面，
  // 這樣會不容易看到其他分頁有提示...在返回的圖示上加小紅點" — a staff login
  // lands straight on Time & Attendance (see the sign-in effect above), so
  // they may never see the section grid (/home) or even My Dashboard's own
  // chooser where an update would otherwise be visible. This is the same
  // problem one level up from what each layout's own back-bar badge solves
  // (SectionTabLayout.jsx/DashboardLayout.jsx/TrainingCentreLayout.jsx,
  // right below) — the "▦ go to sections" header button is the only way
  // back to EVERY section, not just the current one, so it gets its own
  // "something's new, somewhere" dot: the same badgeForKeys lookup every
  // other nav surface uses, run across literally every page this person can
  // reach (not a hand-picked subset like badgeCount above), so a future
  // signal added to navBadges.js shows up here automatically too.
  const auditPending = useAuditPending(profile, effectivePages)
  const anywhereSignals = { rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies, auditPending }
  const anywhereFullKeys = orderedSectionEntries(sidebarOrder).flatMap(([sectionKey]) =>
    logicalPageEntries(sectionKey, sidebarOrder).flatMap((entry) =>
      entry.type === 'group'
        ? entry.pages.filter((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`)).map((p) => `${sectionKey}.${p}`)
        : canAccessPage(effectivePages, `${sectionKey}.${entry.key}`)
          ? [`${sectionKey}.${entry.key}`]
          : []
    )
  )
  const anywhereBadge = badgeForKeys(anywhereFullKeys, anywhereSignals)
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    if (badgeCount > 0) {
      navigator.setAppBadge(badgeCount).catch(() => {})
    } else {
      navigator.clearAppBadge().catch(() => {})
    }
  }, [badgeCount])
  // Jeff, 2026-10-21 (follow-up): "訊息讀取後，dashboard跟message的提示消失，
  // 但手機圖示的數字提醒還存在" — reading a message/bulletin in the app
  // updates AuthContext (clears the in-app dot/count instantly, via
  // badgeCount above) but does nothing to the actual push notification
  // push-sw.js already showed — that's what the OS icon badge is really
  // counting (see the comment above), and it has its own separate
  // lifecycle. Closing it once badgeCount is actually back to 0 keeps the
  // two in sync.
  // Jeff, 2026-10-21 (correction): "應該不是打開手機就清掉桌面圖示，而是應該
  // 造成提示的訊息閱讀了，桌面圖示提醒才會清掉" — an earlier version of this
  // cleared the shown notification unconditionally on every app open/
  // foreground, regardless of whether badgeCount was still > 0 (reasoning at
  // the time: "having it open already means they've seen it" — Jeff's own
  // call then, reversed now). That let the icon go blank before the message
  // was actually read, which could hide a push someone only glanced past.
  // Now the icon only ever gets cleared in step with badgeCount reaching 0 —
  // the same real "have you actually read this" signal the in-app dots use,
  // not just "was the app opened". AuthContext's own visibilitychange
  // refresh (added the same day) is what keeps badgeCount itself current
  // without needing a full close+reopen, so this effect no longer needs its
  // own visibilitychange listener — it only has to react when badgeCount
  // changes, however that change happened.
  useEffect(() => {
    if (!isPushSupported() || badgeCount > 0) return
    navigator.serviceWorker.ready
      .then((reg) => reg.getNotifications())
      .then((list) => list.forEach((n) => n.close()))
      .catch(() => {})
  }, [badgeCount])
  // Jeff, 2026-10-21: "還是做完整的 Web Push，這樣員工使用起來才知道有訊息
  // 可以點進去看" — a toggle buried in My Information (MyInformationPage.jsx
  // has the full on/off control) won't get found organically, so this is a
  // one-time nudge: shown once per device while notification permission is
  // still undecided, dismissible, remembered in localStorage (per-device is
  // the right scope here anyway — a push subscription is inherently
  // per-device, unlike every other profile-level "seen" flag in this file).
  const [showPushNudge, setShowPushNudge] = useState(false)
  useEffect(() => {
    if (!profile?.id || !isPushSupported() || isIosNonStandalone()) return
    // Jeff, 2026-10-21: "確認一下2d maker跟accountant不會收到推播通知" —
    // this banner wasn't gated by role at all, so an accountant (a real
    // person, unlike the device-account qr_code_maker) could tap it and
    // start getting push despite having no access to Bulletin Board/My
    // Information in the first place (permissions.js). None of
    // NON_PICKABLE_STAFF_ROLES (training/qr_code_maker/accountant) should
    // ever be offered push — the announcement trigger now also excludes
    // them at the source (migration 0132) as defense in depth, but this is
    // what stops a subscription row from being created for them at all.
    if (NON_PICKABLE_STAFF_ROLES.includes(profile.role)) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
    let dismissed = false
    try {
      dismissed = localStorage.getItem('ot_push_nudge_dismissed') === '1'
    } catch {
      /* ignore */
    }
    if (!dismissed) setShowPushNudge(true)
  }, [profile?.id, profile?.role])
  const dismissPushNudge = () => {
    setShowPushNudge(false)
    try {
      localStorage.setItem('ot_push_nudge_dismissed', '1')
    } catch {
      /* ignore */
    }
  }
  const enablePushFromNudge = async () => {
    try {
      await subscribeToPush(profile.id)
    } catch {
      /* the My Information page explains failures in more detail; a silent
         no-op here just means the button stays visible to retry */
    }
    dismissPushNudge()
  }

  // Jeff, 2026-10-21 (further follow-up): "有辦法登入時如果發現新版本，先讓
  // 其正常登入進去，再banner提示有新版本請確認更新...或者是有辦法做到員工
  // 離開app那一瞬間，系統背後自己做更新?" — registerType is now 'prompt'
  // (vite.config.js/swUpdate.js), so a newly-found update sits waiting
  // instead of forcing itself through.
  //
  // Jeff, 2026-10-21 (yet another follow-up): "如果跳出時會自動更新，感覺
  // 畫面上方的小提示...是不是就不需要" — right: this app's actual usage
  // (phones get locked, store computers get shut down normally — Jeff
  // confirmed) is already covered without it. Locking a phone screen fires
  // 'visibilitychange' → 'hidden' on both iOS/Android while the tab is
  // still open, which the effect below catches directly. A normal computer
  // shutdown (or just closing the browser) goes further: once every
  // tab/window this service worker controls is gone, there's nothing left
  // for the OLD worker to keep controlling, so the browser activates the
  // waiting one entirely on its own — no code of ours even needs to run
  // for that case. The one device this wouldn't reach is a screen left
  // open and in the foreground all day, never locked or closed (a tablet
  // mounted as a standing kiosk) — no store runs one that way, so the
  // visible banner + manual "Update now" button were dropped; this effect
  // (silently applying the moment a tab IS backgrounded) is kept as the
  // one case worth covering proactively rather than waiting for a full
  // close.
  useEffect(() => {
    const cancelWatch = watchForUpdate(() => {})
    function onHidden() {
      if (document.visibilityState === 'hidden') applyUpdate()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      cancelWatch()
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])
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
  const isAdminCenter = location.pathname.startsWith('/admin-center') || location.pathname.startsWith('/developer-tools') ||
    // Audit Settings is one form shared by every store.
    location.pathname === '/audit/settings'

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

  // Jeff, 2026-10-16: "保留，但在登入時跳出視窗顯示提醒" — the staff member's
  // own half of the training-hours reminder (used to be a 'training_hours'
  // Bulletin card everyone saw; the manager-facing half is now a system
  // Message instead — see BulletinPage.jsx's notifyManagersOfTrainingHours)
  // becomes a one-time-per-band login popup here, same shape as
  // showQualifiedPopup above. Only ever relevant for someone who isn't
  // qualified yet and isn't one of the non-trainee accounts
  // (NON_PICKABLE_STAFF_ROLES) — mirrors exactly who Bulletin's old
  // self-view branch used to cover. Needs its own hours fetch since
  // AppShell doesn't otherwise touch attendance data.
  const tracksTrainingHours = !!profile?.id && !profile.qualified && !NON_PICKABLE_STAFF_ROLES.includes(profile.role)
  const [workedHours, setWorkedHours] = useState(null)
  useEffect(() => {
    if (!tracksTrainingHours) {
      setWorkedHours(null)
      return
    }
    let cancelled = false
    // Jeff, 2026-10-17: waits a few seconds after login (this reads every one of
    // the person's attendance events) so it doesn't compete with what the first
    // screen needs; a failed read just means no popup this time.
    const timer = setTimeout(() => {
      getWorkedMinutesByProfile([profile.id])
        .then((byProfile) => {
          if (!cancelled) setWorkedHours((byProfile[profile.id] ?? 0) / 60)
        })
        .catch(() => {})
    }, 4000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tracksTrainingHours, profile?.id])
  const trainingHoursInfo = tracksTrainingHours && workedHours != null ? trainingHoursBandInfo(workedHours) : null
  const showTrainingHoursPopup =
    !!trainingHoursInfo && trainingHoursInfo.band > (profile?.training_hours_popup_seen_band ?? 0)
  const dismissTrainingHoursPopup = async () => {
    if (profile?.id && trainingHoursInfo) {
      await supabase
        .from('profiles')
        .update({ training_hours_popup_seen_band: trainingHoursInfo.band })
        .eq('id', profile.id)
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

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-brand-100 px-3 py-3 md:px-6">
            <div className="flex min-w-0 items-center gap-2">
              {hasSidebar && (
                // Jeff, 2026-10-19 (mobile nav redesign, point 1): replaces
                // the old hamburger + slide-out drawer — this now jumps
                // straight to MobileSectionHome's colored section grid
                // (routes.jsx's /home), the "go up a level" screen for
                // switching sections on a phone. Desktop never shows this;
                // its permanent <aside> sidebar covers the same job already.
                <button
                  onClick={() => navigate('/home')}
                  className="relative shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 md:hidden"
                  aria-label="Go to sections"
                  title="Sections"
                >
                  ▦
                  <NavBadge badge={anywhereBadge} corner />
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
          {showPushNudge && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm md:px-6">
              <span className="text-brand-800">🔔 Turn on push notifications so you don't miss new messages, announcements, and roster updates.</span>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={enablePushFromNudge} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">
                  Turn on
                </button>
                <button onClick={dismissPushNudge} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">
                  Later
                </button>
              </div>
            </div>
          )}
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
      {/* Shown only once showQualifiedPopup has nothing to say — the rarer,
          more celebratory popup takes priority on the (rare) login where
          both would otherwise fire at once. */}
      {!showQualifiedPopup && showTrainingHoursPopup && (
        <Modal open onClose={dismissTrainingHoursPopup} title="⏱️ Training Hours">
          <p className="text-sm text-gray-700">{trainingHoursReminderTitle(trainingHoursInfo, { isSelf: true })}</p>
          <div className="mt-4 flex justify-end">
            <button
              onClick={dismissTrainingHoursPopup}
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
