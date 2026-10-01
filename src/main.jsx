import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

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
if ('serviceWorker' in navigator) {
  let reloadedForUpdate = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return
    reloadedForUpdate = true
    window.location.reload()
  })
}
