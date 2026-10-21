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
// service worker hands control of this page over to a newer version once
// one is found and told to activate (see vite.config.js / swUpdate.js for
// when/how that now happens) — but nothing was ever listening for that
// handover, so the page just kept running on whatever JS it already had
// loaded in memory until the next *genuinely fresh* network load. "Swipe
// up" to dismiss an installed home-screen app (especially on iOS) usually
// just suspends it rather than tearing it down, so that fresh load often
// never happened — only a full uninstall/reinstall reliably forced one.
// `controllerchange` fires exactly once, the moment a different service
// worker actually takes over an already-open page — reloading right then
// is what makes an update actually show up on its own. See
// src/lib/pwaUpdate.js for the companion manual "check now" button (My
// Information > App), and src/lib/swUpdate.js/AppShell.jsx for the "update
// available" banner / background auto-apply.
//
// Jeff, 2026-10-21 (further follow-up): registerType is now 'prompt' (see
// vite.config.js/swUpdate.js), so controllerchange can only ever fire as a
// result of OUR OWN explicit applyUpdate() call now — never spontaneously
// mid-login the way it could when a build happened to land at exactly the
// wrong moment. The criticalSection check below is kept anyway as a plain
// backstop (defense in depth costs nothing here), with a generous timeout
// fallback so a future bug that forgets to call endCriticalSection can
// never mean an already-applied update just silently never shows up.
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
