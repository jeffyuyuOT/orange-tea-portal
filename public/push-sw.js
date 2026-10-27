// Jeff, 2026-10-21: full Web Push listeners, importScripts()'d into the
// generateSW-produced service worker (see vite.config.js's
// workbox.importScripts) rather than switching PWA strategy — keeps every
// precache/runtimeCaching/navigateFallback rule there untouched. Plain JS,
// no bundler, no imports — nothing here needs one.

// Jeff, 2026-10-21 (further follow-up): vite.config.js's registerType is now
// 'prompt' (workbox.skipWaiting: false) — a newly-installed version of this
// worker sits in `waiting` until something explicitly tells it to take
// over, instead of activating itself the instant it's found. src/lib/
// swUpdate.js is that "something": it posts this exact message once it's
// actually safe to update (AppShell.jsx's banner, or the tab going to the
// background). Added here rather than in the main generateSW config since
// everything else in this file already extends the generated SW the same
// way (importScripts), so every precache/runtimeCaching rule stays exactly
// as workbox generated it.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // ignore — fall back to defaults below
  }
  const title = data.title || 'OT Portal'
  event.waitUntil(
    (async () => {
      // Jeff, 2026-10-27: "推播提示在samsung手機常常會讀完，提示還是卡在
      // 那，必須要去setting-app-force stop後，提示才會消失" — Samsung's
      // One UI launcher has a known issue where its home-screen icon badge
      // count doesn't reliably decrement when a same-`tag` push silently
      // replaces an older notification in place; explicitly close()-ing
      // the old one first (instead of just relying on showNotification's
      // own tag-replace behavior) is the documented workaround, since
      // close() is what reliably signals the OS/launcher that a
      // notification actually went away. `renotify: true` below makes the
      // replacement still alert (same as any other new push) instead of
      // silently swapping in place. This only has an effect once data.tag
      // is actually set by the sender — see migration 0147 (giving each
      // push category — message/announcement/formula_update/
      // roster_change — its own stable tag at the source, so a second
      // push of the same kind replaces the first instead of stacking up
      // separate notifications; not yet applied, needs a separate
      // approval — see the chat).
      if (data.tag) {
        const existing = await self.registration.getNotifications({ tag: data.tag })
        existing.forEach((n) => n.close())
      }
      await self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: data.tag,
        renotify: true,
        data: { url: data.url || '/' },
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if (client.navigate) return client.navigate(url).then((c) => c.focus())
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
