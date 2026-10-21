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
export async function checkForAppUpdate() {
  if (!('serviceWorker' in navigator)) return { supported: false, updateFound: false }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return { supported: true, updateFound: false }
  await reg.update()
  if (reg.installing) {
    // Give the newly-found worker a moment to finish installing so
    // reg.waiting is actually set below — it isn't ready to skipWaiting the
    // instant `update()` resolves. Capped so the button never hangs if
    // something unexpected happens (e.g. install fails).
    const installingWorker = reg.installing
    await new Promise((resolve) => {
      const onChange = () => {
        if (installingWorker.state !== 'installing') {
          installingWorker.removeEventListener('statechange', onChange)
          resolve()
        }
      }
      installingWorker.addEventListener('statechange', onChange)
      setTimeout(resolve, 5000)
    })
  }
  if (reg.waiting) applyUpdate(reg)
  return { supported: true, updateFound: !!reg.waiting }
}
