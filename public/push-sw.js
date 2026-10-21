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
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    })
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
