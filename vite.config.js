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
      },
    }),
  ],
})