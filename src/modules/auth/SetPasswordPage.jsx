import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
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
export default function SetPasswordPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('checking') // checking | ready | invalid | done
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function establishSession() {
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
    const { error: updateError } = await supabase.auth.updateUser({ password })
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

  if (status === 'invalid') {
    return (
      <AuthLayout title="Link expired">
        <p className="text-sm text-gray-600">
          This link is invalid or has already been used. Ask an admin to resend the invite or password reset email,
          then open that new email's link directly (not a forwarded copy, and only once).
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
        <Button type="submit" className="w-full">
          Set password
        </Button>
      </form>
    </AuthLayout>
  )
}
