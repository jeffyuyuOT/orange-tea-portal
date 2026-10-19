import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'

// Jeff, 2026-10-19: gates a sensitive page (Payroll, BK) behind a second
// factor on top of ordinary sign-in — "payroll跟BK分頁想做two factor
// authentitation...如果經2FA進入分頁後重新登入前可以直接切換頁面，如果重新
// 登入後，就得再經2FA進入分頁". Uses Supabase Auth's own built-in MFA (TOTP)
// rather than anything homemade (a second PIN would just be "another thing
// you know", not a real second FACTOR) — see the AAL (Authenticator
// Assurance Level) check below. The key reason this is the right fit: the
// "verified this login" state lives in the Supabase session itself (its
// AAL), not in anything we store ourselves — it survives page refreshes
// and switching between Payroll/BK freely, and only resets back to aal1 on
// a genuine new sign-in (a brand-new session), exactly the behaviour Jeff
// asked for, with no bespoke "has this session already verified?" table to
// keep in sync ourselves.
//
// Deliberately only wraps the two developer_tools routes in routes.jsx —
// everything else in the app keeps working exactly as before. See
// permissions.js's developer_tools section comment for why only the
// `developer` role can even reach this far in the first place (page-level
// access is unchanged by this; this only adds a second check once they're
// already past that).
export default function RequireTwoFactor({ children }) {
  const [status, setStatus] = useState('checking') // checking | enroll | challenge | ok | error
  const [factorId, setFactorId] = useState(null)
  const [qr, setQr] = useState(null)
  const [secret, setSecret] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refresh() {
    setStatus('checking')
    setError('')
    setCode('')
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aalError) {
      setError(aalError.message)
      setStatus('error')
      return
    }
    // Already stepped up to aal2 for THIS session (verified earlier this
    // same login, possibly on a different page/tab) — nothing more to do.
    if (aal.currentLevel === 'aal2') {
      setStatus('ok')
      return
    }
    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()
    if (factorsError) {
      setError(factorsError.message)
      setStatus('error')
      return
    }
    const verifiedTotp = (factorsData?.totp ?? []).find((f) => f.status === 'verified')
    if (verifiedTotp) {
      // Already enrolled from a previous login — just need this session to
      // pass the challenge, not re-enroll.
      setFactorId(verifiedTotp.id)
      setStatus('challenge')
      return
    }
    // No verified factor yet, so this is a first-time setup. Clean up any
    // half-finished enrollments left over from an abandoned attempt (closed
    // the tab before scanning/confirming) — Supabase won't reuse the same
    // friendly name otherwise, and they're useless half-enrolled anyway.
    const unverified = (factorsData?.totp ?? []).filter((f) => f.status !== 'verified')
    for (const f of unverified) {
      try {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      } catch {
        // Not worth failing the whole flow over leftover cleanup.
      }
    }
    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Payroll/BK',
    })
    if (enrollError) {
      setError(enrollError.message)
      setStatus('error')
      return
    }
    setFactorId(enrolled.id)
    setQr(enrolled.totp.qr_code)
    setSecret(enrolled.totp.secret)
    setStatus('enroll')
  }

  // Shared by both the enroll-confirmation and the plain-challenge screens
  // — either way it's "open a fresh challenge against this factor, then
  // verify the code against it". A challenge is short-lived, so this is
  // created right before verifying rather than reused from an earlier step.
  async function submitCode() {
    setBusy(true)
    setError('')
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
      if (challengeError) throw challengeError
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      })
      if (verifyError) throw verifyError
      setStatus('ok')
    } catch (err) {
      setError(err.message ?? 'Verification failed.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'checking') {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner label="Checking security…" />
      </div>
    )
  }

  if (status === 'ok') return children

  if (status === 'error') {
    return (
      <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <button onClick={refresh} className="mt-3 text-sm font-medium text-red-700 underline">
          Try again
        </button>
      </div>
    )
  }

  const isEnroll = status === 'enroll'

  return (
    <div className="flex justify-center py-10">
      <div className="w-full max-w-sm rounded-2xl border border-brand-100 bg-white p-7 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-xl text-white">
          {isEnroll ? '🔒' : '🔑'}
        </div>
        <h2 className="mb-1 text-base font-semibold text-gray-900">
          {isEnroll ? 'Set up two-factor authentication' : 'Verification required'}
        </h2>
        <p className="mb-5 text-sm leading-relaxed text-gray-500">
          {isEnroll
            ? 'To protect Payroll / BK data, scan this QR code with an authenticator app (Google Authenticator, Authy, Microsoft Authenticator…), then enter the 6-digit code it shows.'
            : "You haven't verified this page yet this login. Open your authenticator app and enter the current 6-digit code."}
        </p>

        {isEnroll && (
          <>
            {qr && <img src={qr} alt="2FA QR code" className="mx-auto mb-3 h-40 w-40 rounded-lg border border-gray-200 p-2" />}
            <div className="mb-5 flex items-center justify-center gap-2">
              <span className="text-xs text-gray-400">Or enter this key manually:</span>
              <code className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">{secret}</code>
            </div>
          </>
        )}

        <OtpInput value={code} onChange={setCode} />

        {error && <p className="mb-3 -mt-2 text-sm text-red-600">{error}</p>}

        <Button className="w-full" disabled={code.length !== 6 || busy} onClick={submitCode}>
          {busy ? 'Verifying…' : isEnroll ? 'Verify & enable' : 'Verify'}
        </Button>
      </div>
    </div>
  )
}

// Six individual boxes (auto-advance on type, backspace steps back, and a
// 6-digit paste fills every box at once — authenticator apps/password
// managers commonly offer a one-tap copy of the current code) rather than
// one plain text input, matching the mock-up Jeff already signed off on.
function OtpInput({ value, onChange }) {
  const refs = useRef([])
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '')

  function setDigit(i, d) {
    const next = digits.slice()
    next[i] = d
    onChange(next.join('').replace(/\s+$/, ''))
    if (d && i < 5) refs.current[i + 1]?.focus()
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    e.preventDefault()
    onChange(pasted)
    refs.current[Math.min(pasted.length, 5)]?.focus()
  }

  return (
    <div className="mb-5 flex justify-center gap-2" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={d}
          maxLength={1}
          inputMode="numeric"
          autoFocus={i === 0}
          onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus()
          }}
          className="h-11 w-9 rounded-lg border border-gray-300 text-center text-lg font-semibold text-gray-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      ))}
    </div>
  )
}
