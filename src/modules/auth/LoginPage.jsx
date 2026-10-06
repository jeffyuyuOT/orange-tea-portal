import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import Button from '../../components/ui/Button'
import AuthLayout from './AuthLayout'

// Jeff, 2026-10-07: "training staff現在不需要經過training code就可以登入" —
// this used to have a second step after a training-role account's regular
// sign-in, requiring that week's 4-digit training code (set by a manager in
// Shop Management > Training Code) before the session counted as fully
// signed in. Both the step and the Training Code tab it depended on are
// gone now — see AuthContext.jsx (needsTrainingCode/verifyTrainingCode,
// removed) and TrainingCentreLayout.jsx/permissions.js. Plain sign-in only.
export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err.message ?? 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  )
}
