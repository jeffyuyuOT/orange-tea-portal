// Jeff, 2026-10-21: Sophie's "一直轉圈圈進不去" (RequireAuth.jsx stuck on
// "Loading your session…") kept happening specifically around the times
// Jeff was actively pushing new builds — and that's not a coincidence.
// pwaUpdate.js already explains why: the browser only actually checks for a
// newer sw.js on a genuinely fresh page load, which is EXACTLY the same
// moment AuthContext.jsx's getSession()/loadProfileData() is also running.
// If a new build was deployed since her last visit, opening the app can
// trigger, on that same load: the service worker finding the update,
// self.skipWaiting()+clientsClaim() handing control to it almost
// immediately, main.jsx's `controllerchange` listener firing, and
// window.location.reload() tearing the page down — all while her sign-in
// is still in flight. The reload doesn't just interrupt that request, it
// aborts it outright, so even the getSession()/signIn() network-blip
// retries never get a chance to run; the fresh reload just starts the same
// race over again, which is what repeated reload cycles would actually
// look like to her ("一直轉圈圈").
//
// This is a tiny shared "something auth-critical is in flight" flag so
// main.jsx can hold the forced reload until it's actually safe, instead of
// forcing it through at the worst possible moment. Deliberately NOT tied to
// React state (nothing here renders) — AuthContext's getSession/
// loadProfileData/signIn just bump this count up while they're running and
// down when they finish, from plain try/finally, no component involved.
let busyCount = 0
const listeners = new Set()

export function beginCriticalSection() {
  busyCount++
}

export function endCriticalSection() {
  busyCount = Math.max(0, busyCount - 1)
  if (busyCount === 0) {
    const toNotify = Array.from(listeners)
    listeners.clear()
    toNotify.forEach((fn) => fn())
  }
}

export function isCriticalSectionActive() {
  return busyCount > 0
}

// One-shot: fires once, the next time the count reaches zero. main.jsx uses
// this with its own timeout fallback (in case something above never calls
// endCriticalSection — a bug there should never mean an update silently
// never applies).
export function onCriticalSectionClear(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
