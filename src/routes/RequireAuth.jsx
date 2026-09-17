import { useAuth } from '../lib/AuthContext'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import LoginPage from '../modules/auth/LoginPage'

export default function RequireAuth({ children }) {
  const { user, profile, loading, needsTrainingCode } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner label="Loading your session…" />
      </div>
    )
  }
  if (!user || needsTrainingCode || !profile) return <LoginPage />
  return children
}
