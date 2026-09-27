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