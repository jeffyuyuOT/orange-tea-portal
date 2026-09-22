import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import Button from '../../components/ui/Button'
import AuthLayout from './AuthLayout'

export default function LoginPage() {
  const { signIn, needsTrainingCode, verifyTrainingCode, profile } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [trainingCode, setTrainingCode] = useState('')
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

  async function handleTrainingCode(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await verifyTrainingCode(trainingCode)
    } catch (err) {
      setError(err.message ?? 'Verification failed.')
    } finally {
      setBusy(false)
    }
  }

  // Step 2: Training-role accounts must also enter this week's 4-digit
  // training code (set by a manager in Shop Management > Training Code).
  if (profile && needsTrainingCode) {
    return (
      <AuthLayout title="Training verification">
        <form onSubmit={handleTrainingCode} className="space-y-4">
          <p className="text-sm text-gray-500">Enter this week's 4-digit training code from your manager.</p>
          <input
            value={trainingCode}
            onChange={(e) => setTrainingCode(e.target.value)}
            maxLength={4}
            inputMode="numeric"
            placeholder="0000"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-2xl tracking-[0.5em] focus:border-brand-400 focus:outline-none"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Checking…' : 'Continue'}
          </Button>
        </form>
      </AuthLayout>
    )
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
