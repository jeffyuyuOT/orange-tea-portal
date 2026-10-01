// My Information's "Check for Updates" button — Jeff, 2026-10-02: "下載到
// 手機後,因為又有向上滑不會重新整理的設置,有時候軟體update後沒辦法即時呈
// 現,必須uninstall再install才有辦法。有沒有什麼辦法...在my information裡
// 設置一個重新整理的按鈕，讓下載程式可以更新".
//
// The service worker this app registers (vite-plugin-pwa, registerType:
// 'autoUpdate') already self-activates a newer version the instant the
// browser finds one — self.skipWaiting() + clientsClaim() are baked into
// every build (see vite.config.js and the generated sw.js) — and
// main.jsx's `controllerchange` listener reloads the page the moment that
// handover happens. The missing piece was never "activate" or "reload" —
// it's that the browser only actually CHECKS whether a newer sw.js exists
// on its own schedule (a genuinely fresh page navigation, or its own
// background check roughly every 24h). An installed home-screen app that's
// merely suspended and resumed — iOS "swipe up" out of the app switcher in
// particular almost never counts as a fresh navigation — can sit on a
// stale build for a long time without that check ever firing, which is
// what forced Jeff to uninstall/reinstall before.
//
// This is the manual equivalent of that check: ask the browser right now
// whether a newer sw.js exists on the server. If it finds one, main.jsx's
// controllerchange listener handles the actual reload on its own — this
// only reports whether one was found, so the button can tell the person
// something happened either way instead of silently doing nothing when
// they're already on the latest version.
export async function checkForAppUpdate() {
  if (!('serviceWorker' in navigator)) return { supported: false, updateFound: false }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return { supported: true, updateFound: false }
  await reg.update()
  return { supported: true, updateFound: !!(reg.installing || reg.waiting) }
}
