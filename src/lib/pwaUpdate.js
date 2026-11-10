import { applyUpdate } from './swUpdate'

// My Information's "Check for Updates" button — Jeff, 2026-10-02: "下載到
// 手機後,因為又有向上滑不會重新整理的設置,有時候軟體update後沒辦法即時呈
// 現,必須uninstall再install才有辦法。有沒有什麼辦法...在my information裡
// 設置一個重新整理的按鈕，讓下載程式可以更新".
//
// The browser only actually CHECKS whether a newer sw.js exists on its own
// schedule (a genuinely fresh page navigation, or its own background check
// roughly every 24h). An installed home-screen app that's merely suspended
// and resumed — iOS "swipe up" out of the app switcher in particular almost
// never counts as a fresh navigation — can sit on a stale build for a long
// time without that check ever firing, which is what forced Jeff to
// uninstall/reinstall before.
//
// This is the manual equivalent of that check: ask the browser right now
// whether a newer sw.js exists on the server.
//
// Jeff, 2026-10-21 (further follow-up): registerType switched to 'prompt'
// (see vite.config.js/swUpdate.js) — a newer version found in the
// BACKGROUND no longer self-activates; it waits for swUpdate.js to say when
// (AppShell.jsx's banner, or the tab going to the background), so it can't
// interrupt something like a login in progress. This button is different:
// someone explicitly asking "is there a newer version, and if so get me on
// it now" is exactly the one case where applying it immediately is still
// the right call (same as this button has always done) — main.jsx's
// `controllerchange` listener handles the actual reload once that handover
// completes, same as before.
// Long enough for a phone on mobile data to pull the whole precache.
const INSTALL_WAIT_MS = 45000

export async function checkForAppUpdate() {
  if (!('serviceWorker' in navigator)) return { supported: false, updateFound: false }
  let reg = await navigator.serviceWorker.getRegistration()
  // Jeff, 2026-10-27: "現在有更新的話手機去my information - check for
  // update都會找不到，要登出再登入才找的到" — getRegistration() with no
  // scope argument re-derives the registration from the CURRENT page's URL
  // every time it's called, and on some mobile browsers (seen on Samsung
  // devices) that lookup can come back empty on a long-lived page even
  // though a service worker is genuinely controlling it — logging out and
  // back in forces a real navigation, which resets whatever the browser was
  // getting confused by and makes the same lookup succeed again.
  // `serviceWorker.ready` resolves a different way (from the registration
  // actually controlling this page, not re-derived from the URL each time),
  // so it's a more reliable fallback here — capped with a timeout so a
  // genuinely unsupported/uncontrolled page can't hang this button forever.
  if (!reg) {
    reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]).catch(() => null)
  }
  if (!reg) return { supported: true, updateFound: false }
  // Jeff, 2026-11-10: "check for update都要登出再登入才找的到更新版本" — the old version of
  // this decided "already latest" far too early, in three ways:
  //  - reg.update() can reject (offline / flaky mobile network) and that went
  //    unhandled, so the button either stuck on "Checking…" or the result was read
  //    as up to date;
  //  - update() resolves once the new sw.js has been fetched, but the new worker then
  //    has to download the whole precache before it reaches "waiting" — on a phone
  //    that routinely takes longer than the old 5 s cap, so reg.waiting was still
  //    empty and it reported "latest version"; by the time the person logged out and
  //    in again the download had finished and the same check suddenly found it;
  //  - a worker that was ALREADY waiting (found earlier by the background check) was
  //    only noticed if update() happened to run cleanly first.
  // So: use an already-waiting worker straight away, treat a failed check as "couldn't
  // check" instead of "up to date", and wait up to INSTALL_WAIT_MS for a worker that is
  // still installing.
  if (reg.waiting) {
    applyUpdate(reg)
    return { supported: true, updateFound: true }
  }
  let sawUpdateFound = false
  const onFound = () => {
    sawUpdateFound = true
  }
  reg.addEventListener('updatefound', onFound)
  try {
    await reg.update()
  } catch {
    reg.removeEventListener('updatefound', onFound)
    return { supported: true, updateFound: false, failed: true }
  }
  // updatefound can be delivered a beat after update() resolves.
  if (!reg.installing && !reg.waiting && !sawUpdateFound) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  reg.removeEventListener('updatefound', onFound)
  const installingWorker = reg.installing
  if (installingWorker && installingWorker.state === 'installing') {
    await new Promise((resolve) => {
      const onChange = () => {
        if (installingWorker.state !== 'installing') {
          installingWorker.removeEventListener('statechange', onChange)
          resolve()
        }
      }
      installingWorker.addEventListener('statechange', onChange)
      setTimeout(resolve, INSTALL_WAIT_MS)
    })
  }
  if (reg.waiting) {
    applyUpdate(reg)
    return { supported: true, updateFound: true }
  }
  return { supported: true, updateFound: false }
}
