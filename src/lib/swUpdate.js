// Jeff, 2026-10-21: "有辦法登入時如果發現新版本，先讓其正常登入進去，再
// banner提示有新版本請確認更新...或者是有辦法做到員工離開app那一瞬間，系統
// 背後自己做更新?" — vite.config.js's registerType switched from
// 'autoUpdate' to 'prompt', so a newly-downloaded service worker no longer
// self.skipWaiting()s the instant it's found — it just sits in
// `registration.waiting` until THIS code explicitly tells it to take over
// (postMessage('SKIP_WAITING') — push-sw.js listens for that message and
// calls self.skipWaiting() itself). That means an update arriving mid-login
// can never force a reload through it any more at all (criticalSection.js's
// guard is now a backstop, not the main defense) — AND it's what makes it
// possible to apply the update whenever is LEAST disruptive instead of the
// instant it's found: AppShell.jsx uses watchForUpdate() to show a small
// "update available" banner (same idea as the push nudge banner) once one
// is ready, and auto-calls applyUpdate() the moment the tab is backgrounded
// (visibilitychange -> hidden) so most people never even see the banner —
// by the time they come back it's already current. main.jsx's existing
// controllerchange listener still does the actual page reload once the
// handover completes either way.
let readyRegistration = null
// Set by watchForUpdate once it has a registration — lets requestUpdateCheck() below ask the
// browser to look for (and start downloading) a newer version on demand.
let activeRegistration = null

// Jeff, 2026-11-11: the silent apply-on-background was removed. AppShell.jsx now shows an
// admin-controlled popup ("Update now" / "Update when I close the app"); this just starts
// the download so a worker is already waiting by the time the app goes to the background.
export function requestUpdateCheck() {
  activeRegistration?.update().catch(() => {})
}

// Jeff, 2026-11-10: "為什麼我現在手機板都沒有做到悄悄更新的動作" — two gaps kept the
// silent apply above from ever having anything to apply on a phone:
//  1. Nothing here ever ASKED the browser whether a newer sw.js exists. The browser
//     only checks on its own — on a genuinely fresh page navigation, or roughly once a
//     day in the background — and an installed home-screen app that is just locked and
//     resumed never navigates, so it could sit on an old build for a long time with no
//     waiting worker at all (pwaUpdate.js's own comment describes the same thing).
//     So the registration is now asked to update() when the app starts, whenever it
//     comes back to the foreground, and every UPDATE_CHECK_MS while it stays open.
//  2. getRegistration() alone can come back empty on some phones (the Samsung case
//     pwaUpdate.js's 2026-10-27 comment describes), which meant this listener never
//     attached and readyRegistration was never set — so applyUpdate() had nothing to
//     act on even when a new worker WAS waiting. Same `serviceWorker.ready` fallback
//     pwaUpdate.js already uses.
// Jeff, 2026-11-11: no need to look often — an update that shows up a couple of hours late
// costs nothing. So: when the app opens, when it comes back to the foreground, and every
// couple of hours while it stays open, but never more than once per CHECK_GAP.
const UPDATE_CHECK_MS = 2 * 60 * 60 * 1000
const MIN_CHECK_GAP_MS = 2 * 60 * 60 * 1000

export function watchForUpdate(onReady) {
  if (!('serviceWorker' in navigator)) return () => {}
  let cancelled = false
  let timer = null
  let lastCheck = 0
  let activeReg = null

  function announceIfWaiting(reg) {
    if (reg?.waiting && !cancelled) {
      readyRegistration = reg
      onReady()
    }
  }

  function checkForNewVersion() {
    if (cancelled || !activeReg) return
    const now = Date.now()
    if (now - lastCheck < MIN_CHECK_GAP_MS) return
    lastCheck = now
    // A failed check (offline, flaky mobile network) is simply retried at the next
    // trigger — nothing for the user to see.
    activeReg.update().catch(() => {})
  }

  function onVisible() {
    if (document.visibilityState === 'visible') checkForNewVersion()
  }

  async function findRegistration() {
    let reg = await navigator.serviceWorker.getRegistration()
    if (!reg) {
      reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
      ]).catch(() => null)
    }
    return reg
  }

  findRegistration().then((reg) => {
    if (!reg || cancelled) return
    activeReg = reg
    activeRegistration = reg
    // Covers an update that arrived (and finished installing) before this
    // listener was attached — e.g. one found by a navigation/periodic check
    // on an earlier page of the same session.
    announceIfWaiting(reg)
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') announceIfWaiting(reg)
      })
    })
    checkForNewVersion()
    timer = setInterval(checkForNewVersion, UPDATE_CHECK_MS)
    document.addEventListener('visibilitychange', onVisible)
  })

  return () => {
    cancelled = true
    if (timer) clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export function isUpdateReady() {
  return !!readyRegistration?.waiting
}

// `reg` is optional — pwaUpdate.js's manual "check for updates" button
// already has its own registration reference (from its own getRegistration()
// call) and may be calling this before watchForUpdate's listener above has
// had a chance to record it, so it passes it straight through here rather
// than relying on readyRegistration already being set.
//
// Jeff, 2026-10-21 (further follow-up): "為什麼手機版按check for update找到
// 更新，會一直卡在reloading" — MyInformationPage.jsx's button calls this, then
// just sits on "Update found — reloading…" waiting for main.jsx's
// controllerchange listener to actually reload the page. That chain (postMessage
// -> push-sw.js's self.skipWaiting() -> browser hands control to the new worker
// -> controllerchange fires) is entirely outside our control once this
// postMessage is sent, and on at least some mobile browser/OS combinations it
// can apparently just never complete — no error, nothing to catch, the handover
// simply doesn't happen, so controllerchange never fires and the page is stuck
// showing that text forever. Rather than chase an un-reproducible platform quirk
// blind, add an unconditional fallback here: if nothing has already torn this
// page down (via the real controllerchange reload) within RELOAD_FALLBACK_MS,
// reload it ourselves. Harmless in the normal case — when controllerchange does
// fire, window.location.reload() runs first and destroys this page's JS context
// (this very timer included) well before it would have fired on its own.
const RELOAD_FALLBACK_MS = 8000

export function applyUpdate(reg) {
  const registration = reg ?? readyRegistration
  if (!registration?.waiting) return
  readyRegistration = registration
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS)
}
