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

export function watchForUpdate(onReady) {
  if (!('serviceWorker' in navigator)) return () => {}
  let cancelled = false

  function announceIfWaiting(reg) {
    if (reg?.waiting && !cancelled) {
      readyRegistration = reg
      onReady()
    }
  }

  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg || cancelled) return
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
  })

  return () => {
    cancelled = true
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
export function applyUpdate(reg) {
  const registration = reg ?? readyRegistration
  if (!registration?.waiting) return
  readyRegistration = registration
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
}
