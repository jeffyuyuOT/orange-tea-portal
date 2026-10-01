import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // The developer-only payroll app (public/payroll/index.html) is
        // reachable to anyone who knows the URL (its real access control is
        // the payroll_* tables' RLS, not this route), but there's no reason
        // to have the PWA service worker proactively precache and keep it
        // in EVERY visitor's browser cache the moment they load the portal
        // — that just makes it trivially discoverable (Dev Tools > Cache
        // Storage) to someone who was never meant to know it exists. Left
        // out of the precache manifest, it's only ever fetched on demand,
        // by whoever actually opens /developer-tools/payroll.
        globIgnores: ['payroll/**'],
        // Jeff, 2026-09: "Payroll 連結跳到 Bulletin Board...好像是又開一個
        // 視窗但還是進入ot portal頁面" — this was the real bug, and it's not
        // in the sidebar link at all. Workbox's default NavigationRoute
        // (below) catches EVERY navigation-type request site-wide and serves
        // the React app's own index.html instead — that's what makes normal
        // client-side routing work on a hard refresh of e.g. /roster-hub/
        // history. But PayrollPage.jsx's <iframe src="/payroll/index.html">
        // is ALSO a navigation-type request (loading a full document into a
        // frame), so without this denylist it ALSO got served the React
        // app's index.html instead of the real static payroll file — which
        // then booted the whole OT Portal SPA again, nested inside that
        // iframe, whose router didn't recognize "/payroll/index.html" and
        // redirected itself to "/" → Bulletin Board (see RootRedirect,
        // routes.jsx). Clicking Payroll again from inside THAT nested copy
        // nested another full copy one level deeper — that's the cascading
        // stack of "3 OT Portal windows" from 2 clicks; they were never
        // separate browser windows, just recursively nested iframes.
        // navigateFallbackDenylist tells the SW to let requests under
        // /payroll/ hit the network for real instead of substituting the
        // SPA shell.
        navigateFallbackDenylist: [/^\/payroll\//],
      },
      manifest: {
        name: 'Orange Tea AU Staff & Manager Portal',
        short_name: 'OT Portal',
        description: 'Orange Tea AU staff and manager portal',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#f97316',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Jeff, 2026-10-01: "還是有辦法做widget在手機桌面?" — a real OS-level
        // home-screen widget (Android App Widgets / iOS WidgetKit) isn't
        // something a web app/PWA can provide at all; that needs a native
        // app. This `shortcuts` entry is the closest a PWA CAN do: on
        // Android (and Windows), long-pressing the installed app's icon
        // pops up a small menu of named quick actions that jump straight
        // past the app's normal landing page — so "Scan to Clock In/Out"
        // is reachable in two taps (long-press icon, tap shortcut) without
        // opening the app to its usual first screen first. iOS Safari
        // doesn't support this yet, so this is Android/Windows-only for
        // now; the in-app header button (AppShell.jsx) covers every
        // platform once the app itself is open.
        //
        // Jeff, 2026-10-02: "長按app選clock in/out的快捷鍵能直接進入掃碼的
        // camera介面嗎" — the `?scan=1` here is what makes that actually
        // true: TimeAttendancePage.jsx reads it and opens the camera itself
        // the moment the page is ready, instead of landing on the Clock
        // In/Out tab and still needing one more tap on "Scan to Clock
        // In/Out". Two taps total now (long-press icon, tap shortcut)
        // lands straight in the camera view.
        shortcuts: [
          {
            name: 'Scan to Clock In/Out',
            short_name: 'Clock In/Out',
            url: '/dashboard/time-attendance?scan=1',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
    }),
  ],
})