import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { isCriticalSectionActive, onCriticalSectionClear } from './lib/criticalSection'

// Supabase's "Invite user" / "Reset password" email links land wherever
// the project's Site URL points (often just "/"), carrying either
// `#access_token=...&type=invite|recovery` (implicit flow) or
// `?token_hash=...&type=invite|recovery` (confirm-link flow) — see
// SetPasswordPage.jsx for how each is handled. Catch both shapes here,
// before the router/RequireAuth get a chance to either sign the user
// straight into the app or bounce them to the plain login page instead of
// the "set a password" screen.
//
// An EXPIRED or already-used link doesn't carry `type` at all — Supabase
// instead redirects here with `error=access_denied&error_code=otp_expired`
// (implicit flow) or `?error=...` (confirm-link flow). Without this check,
// that case fell through to rendering the plain app, which — with no
// session — just shows the ordinary sign-in page with no explanation of
// what went wrong. Routing it to /set-password too lets that page show a
// proper "this link has expired" message instead.
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
const searchParams = new URLSearchParams(window.location.search)
const linkType = hashParams.get('type') || searchParams.get('type')
const linkError = hashParams.get('error') || searchParams.get('error') || hashParams.get('error_code') || searchParams.get('error_code')
const isAuthEmailLink =
  (linkType === 'invite' || linkType === 'recovery' || !!linkError) && window.location.pathname !== '/set-password'

if (isAuthEmailLink) {
  window.location.replace('/set-password' + window.location.search + window.location.hash)
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

// Jeff, 2026-10-02: "下載到手機後...swipe起來不會重新整理...有時候軟體
// update後沒辦法即時呈現,必須uninstall再install才有辦法" — the generated
// service worker (vite-plugin-pwa, registerType: 'autoUpdate') already
// self.skipWaiting()s and clientsClaim()s the instant a newer version is
// found (see vite.config.js / the built sw.js), which hands control of
// this page over to the new worker — but nothing was ever listening for
// that handover, so the page just kept running on whatever JS it already
// had loaded in memory until the next *genuinely fresh* network load.
// "Swipe up" to dismiss an installed home-screen app (especially on iOS)
// usually just suspends it rather than tearing it down, so that fresh load
// often never happened — only a full uninstall/reinstall reliably forced
// one. `controllerchange` fires exactly once, the moment a different
// service worker actually takes over an already-open page — reloading
// right then is what makes an update actually show up on its own. See
// src/lib/pwaUpdate.js for the companion manual "check now" button
// (My Information > App) for when the browser hasn't even noticed a newer
// version exists yet.
// Jeff, 2026-10-21: Sophie's "一直轉圈圈進不去" kept happening specifically
// around times Jeff was actively pushing new builds — and that's not a
// coincidence. The browser only actually checks for a newer sw.js on a
// genuinely fresh page load (see pwaUpdate.js), which is the SAME load
// AuthContext.jsx's sign-in/session-restore is also running on. Reloading
// the instant controllerchange fires — which is what this used to do
// unconditionally — can tear that request down mid-flight (not just make it
// slow; the page itself is gone), so even its own network-blip retry never
// gets a chance to run. See criticalSection.js: AuthContext.jsx now brackets
// that flow so this can tell whether it's actually safe to reload. If it's
// not, this waits for it to clear instead of forcing the reload through —
// with a generous timeout fallback so a future bug that forgets to call
// endCriticalSection can never mean an available update just silently never
// applies.
if ('serviceWorker' in navigator) {
  let reloadedForUpdate = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return
    reloadedForUpdate = true
    const doReload = () => window.location.reload()
    if (!isCriticalSectionActive()) {
      doReload()
      return
    }
    const timeout = setTimeout(doReload, 20000)
    onCriticalSectionClear(() => {
      clearTimeout(timeout)
      doReload()
    })
  })
}
