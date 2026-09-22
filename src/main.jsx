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
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
const searchParams = new URLSearchParams(window.location.search)
const linkType = hashParams.get('type') || searchParams.get('type')
const isAuthEmailLink = (linkType === 'invite' || linkType === 'recovery') && window.location.pathname !== '/set-password'

if (isAuthEmailLink) {
  window.location.replace('/set-password' + window.location.search + window.location.hash)
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
