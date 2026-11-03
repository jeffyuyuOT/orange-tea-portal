import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Button from '../../components/ui/Button'

// Jeff, 2026-11-03: two requests, one form —
//   1. Sign-in page: a "Forgot password?" option that asks for an email and
//      sends a reset-password email.
//   2. First-time invite link expired: the "link expired" screen needs a way
//      to get a fresh set-password email without bothering an admin.
// Both are just "type your email, we send a link", so they share this
// component (LoginPage.jsx and SetPasswordPage.jsx).
//
// resetPasswordForEmail() is Supabase's own mechanism, and it already does
// what Jeff asked for: if the email exists in Supabase Auth it sends the
// reset email automatically; if it doesn't, nothing is sent. Supabase
// deliberately returns success in BOTH cases (so strangers can't probe which
// emails have accounts), so the message below is worded neutrally — "if this
// email is registered, a link is on its way" — instead of confirming either
// way. It also works for someone who was invited but never set a password:
// opening the reset link confirms the account and lands on the same "set a
// password" screen as the original invite did.
//
// The link goes back to /set-password (main.jsx would route it there anyway
// even if this URL isn't on the project's Redirect URLs list, since it falls
// back to the Site URL and main.jsx catches `type=recovery`).
//
// Supabase limits each email address to one request per 60 seconds, so the
// button is locked for 60s after a send (same as the "wait" error it would
// otherwise throw).
const COOLDOWN_SECONDS = 60

export default function ResetEmailForm({ submitLabel = 'Send reset email', onCancel, cancelLabel = 'Back to sign in' }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const trimmed = email.trim()
    if (!trimmed) return
    setBusy(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/set-password`,
    })
    setBusy(false)
    if (resetError) {
      if (resetError.status === 429 || /rate limit|security purposes|too many/i.test(resetError.message)) {
        setError('An email was just requested. Please wait a minute before asking for another one.')
        setCooldown(COOLDOWN_SECONDS)
        return
      }
      setError(resetError.message)
      return
    }
    setSent(true)
    setCooldown(COOLDOWN_SECONDS)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {sent ? (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          If <span className="font-medium">{email.trim()}</span> is registered, a link to set your password is on its
          way. It can take a minute — check your junk folder too, and open the link in your regular browser (not inside
          a chat app).
        </div>
      ) : (
        <p className="text-sm text-gray-600">Enter your email and we&apos;ll send you a link to set a new password.</p>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy || cooldown > 0} className="w-full">
        {busy ? 'Sending…' : cooldown > 0 ? `${sent ? 'Send again' : submitLabel} (${cooldown}s)` : sent ? 'Send again' : submitLabel}
      </Button>
      {onCancel && (
        <Button type="button" variant="secondary" className="w-full" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
    </form>
  )
}
