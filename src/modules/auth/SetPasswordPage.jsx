import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import Button from '../../components/ui/Button'
import AuthLayout from './AuthLayout'

// Reached from the link inside a Supabase "Invite user" or "Reset
// password" email (see main.jsx, which routes both link shapes here), and
// also linked directly from My Information for an already-signed-in user
// who just wants to change their password.
//
// Supabase's email link can arrive in one of two shapes depending on how
// the project's email templates are set up:
//   1. Implicit flow — the link carries `#access_token=...&type=invite|
//      recovery` in the URL hash. supabase-js auto-detects this on page
//      load (detectSessionInUrl, on by default), so a session already
//      exists by the time this component checks.
//   2. "Confirm" style — the link carries `?token_hash=...&type=invite|
//      recovery` in the query string instead. Nothing happens
//      automatically for this shape; verifyOtp() below turns it into a
//      session.
// Either way, once there's a session the same "set a new password" form
// works whether this is a brand new account (invite), a reset, or a
// voluntary change from someone already logged in.
//
// Jeff, 2026-10-24: "手機登入顯示錯誤訊息" — this screen (via a reset-password
// link) was showing "AAL2 session is required to update email or password
// when MFA is enabled." instead of actually setting the password. Root
// cause: Jeff's own account has a verified TOTP factor enrolled (the
// "Payroll/BK" authenticator) — Supabase's own security rule is that once
// ANY MFA factor is enrolled, changing that account's password/email
// requires an AAL2 session (i.e. the person has to prove they still hold
// the authenticator, not just a password-reset email link), and the
// invite/reset-link session this page establishes is only ever AAL1. This
// isn't a bug to "turn off" — it's exactly the protection enrolling MFA on
// the Payroll/BK account was for — so the fix is to actually let someone in
// that position step up to AAL2 right here (enter the 6-digit code from
// their authenticator) instead of just hitting a dead end. Nobody else in
// this app has an MFA factor enrolled today, so in practice only Jeff's own
// account will ever see the new "mfa" step below — everyone else's password
// change still goes straight through exactly as before.
export default function SetPasswordPage() {
  const navigate = useNavigate()
  // Someone already signed in to the app (came here from My Information's
  // "Change password"), as opposed to arriving from an email link.
  const { profile, signOut } = useAuth()
  const [status, setStatus] = useState('checking') // checking | ready | invalid | done | mfa
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaFactorId, setMfaFactorId] = useState('')
  const [mfaSubmitting, setMfaSubmitting] = useState(false)
  const [sessionLost, setSessionLost] = useState(false)

  useEffect(() => {
    let mounted = true

    async function establishSession() {
      // An expired or already-used link carries no token at all — Supabase
      // redirects here with error/error_code instead (see main.jsx). Catch
      // that up front rather than falling through to getSession()/verifyOtp,
      // which would just hang in "checking" forever since there's nothing
      // for either to find.
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const searchParams = new URLSearchParams(window.location.search)
      const linkError =
        hashParams.get('error') || searchParams.get('error') || hashParams.get('error_code') || searchParams.get('error_code')
      if (linkError) {
        if (mounted) setStatus('invalid')
        return
      }

      const { data } = await supabase.auth.getSession()
      if (data.session) {
        if (mounted) setStatus('ready')
        return
      }

      const params = new URLSearchParams(window.location.search)
      const tokenHash = params.get('token_hash')
      const type = params.get('type')
      if (tokenHash && type) {
        const { error: otpError } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        if (!otpError) {
          if (mounted) setStatus('ready')
          return
        }
      }

      if (mounted) setStatus('invalid')
    }

    establishSession()

    // Covers the implicit-flow case if supabase-js finishes parsing the
    // URL fractionally after the check above.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setStatus('ready')
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Link flow: the link is dead, ask for a new one. Signed-in flow: the
  // sign-in itself has lapsed, so signing out and back in is the fix.
  function showSessionLost() {
    if (profile) {
      setError('Your sign-in session has expired. Sign out, sign in again, then open Change password again.')
      setSessionLost(true)
    } else {
      setStatus('invalid')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    // Jeff, 2026-10-26: a developer, signed in and coming from My Information,
    // saw the raw "Auth session missing!" here — the app still showed them as
    // signed in, but the Supabase session behind this page was gone. Try once
    // to bring it back with a token refresh; if that fails, say what actually
    // happened instead of Supabase's wording.
    let sessionOk = !!(await supabase.auth.getSession()).data.session
    if (!sessionOk) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      sessionOk = !!refreshed?.session
    }
    if (!sessionOk) {
      showSessionLost()
      return
    }
    let { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError && /auth session missing/i.test(updateError.message)) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed?.session) ({ error: updateError } = await supabase.auth.updateUser({ password }))
    }
    if (updateError) {
      if (/auth session missing/i.test(updateError.message)) {
        showSessionLost()
        return
      }
      // Supabase's documented code for exactly this case (see Error Codes
      // reference): the account has an MFA factor enrolled, and this
      // session hasn't proven it yet. Step up right here instead of just
      // showing the raw message as a dead end.
      if (updateError.code === 'insufficient_aal') {
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()
        const totpFactor = factorsData?.totp?.find((f) => f.status === 'verified')
        if (factorsError || !totpFactor) {
          setError('This account has two-factor authentication enabled, but its authenticator could not be found. Contact an admin.')
          return
        }
        setMfaFactorId(totpFactor.id)
        setStatus('mfa')
        return
      }
      setError(updateError.message)
      return
    }
    setStatus('done')
    setTimeout(() => navigate('/', { replace: true }), 1500)
  }

  // Challenge + verify the enrolled TOTP factor to raise this session from
  // AAL1 to AAL2 (supabase-js refreshes the session for us the moment
  // verify() succeeds), then retry the exact same password update that
  // triggered the step-up in the first place.
  async function handleMfaSubmit(e) {
    e.preventDefault()
    setError('')
    const code = mfaCode.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setMfaSubmitting(true)
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId })
    if (challengeError) {
      setMfaSubmitting(false)
      setError(challengeError.message)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: mfaFactorId, challengeId: challengeData.id, code })
    if (verifyError) {
      setMfaSubmitting(false)
      setError(verifyError.message)
      return
    }
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setMfaSubmitting(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setStatus('done')
    setTimeout(() => navigate('/', { replace: true }), 1500)
  }

  if (status === 'checking') {
    return (
      <AuthLayout title="Set password">
        <p className="text-sm text-gray-500">Verifying your link…</p>
      </AuthLayout>
    )
  }

  if (status === 'mfa') {
    return (
      <AuthLayout title="Enter your authenticator code">
        <p className="mb-4 text-sm text-gray-600">
          This account has two-factor authentication enabled. Enter the 6-digit code from your authenticator app to
          confirm the password change.
        </p>
        <form onSubmit={handleMfaSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Authenticator code</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-lg tracking-widest focus:border-brand-400 focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={mfaSubmitting}>
            {mfaSubmitting ? 'Verifying…' : 'Confirm'}
          </Button>
        </form>
      </AuthLayout>
    )
  }

  if (status === 'invalid') {
    return (
      <AuthLayout title="Link expired">
        <p className="text-sm text-gray-600">
          This link is invalid, has expired, or has already been used. Ask an admin to resend the invite or password
          reset email, then open that new link right away.
        </p>
        <p className="mt-3 text-sm text-gray-600">
          If the link was opened from inside a chat app (LINE, Messenger, etc.) rather than a regular browser, that
          can also invalidate it before you ever tap it — those apps often "preview" links automatically. Try
          long-pressing the link and choosing "Open in Browser" (or copy it and paste it into Safari/Chrome)
          instead of tapping it directly in the chat.
        </p>
        <Button variant="secondary" className="mt-4 w-full" onClick={() => navigate('/')}>
          Back to sign in
        </Button>
      </AuthLayout>
    )
  }

  if (status === 'done') {
    return (
      <AuthLayout title="Password set">
        <p className="text-sm text-gray-600">Your password has been updated. Taking you in…</p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Set a password">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">New password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Confirm password</label>
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {sessionLost && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => signOut()}>
            Sign out
          </Button>
        )}
        <Button type="submit" className="w-full">
          Set password
        </Button>
      </form>
    </AuthLayout>
  )
}
