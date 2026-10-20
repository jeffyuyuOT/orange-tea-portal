// Jeff, 2026-10-21: full Web Push listeners, importScripts()'d into the
// generateSW-produced service worker (see vite.config.js's
// workbox.importScripts) rather than switching PWA strategy — keeps every
// precache/runtimeCaching/navigateFallback rule there untouched. Plain JS,
// no bundler, no imports — nothing here needs one.

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
