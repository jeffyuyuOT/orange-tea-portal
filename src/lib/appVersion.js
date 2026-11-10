// Jeff, 2026-11-11: build id of the code currently running (baked in by vite.config.js) and a
// check against /version.json on the server (written by the same build). A mismatch means a
// newer version has been deployed. Independent of the service worker, so the update popup
// still shows when a phone's service worker is slow to notice. In `vite dev` there is no
// version.json (the fetch returns the app's HTML) so this simply reports false.
export const CURRENT_BUILD = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : null

export async function isNewBuildAvailable() {
  if (!CURRENT_BUILD) return false
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const data = await res.json()
    return !!data?.build && data.build !== CURRENT_BUILD
  } catch {
    return false
  }
}
