import { useAuth } from '../lib/AuthContext'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import LoginPage from '../modules/auth/LoginPage'

export default function RequireAuth({ children }) {
  const { user, profile, loading, needsTrainingCode, signOut } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner label="Loading your session…" />
      </div>
    )
  }
  if (!user || needsTrainingCode || !profile) return <LoginPage />

  // A freshly invited account already has a real login (and, since
  // SetPasswordPage, a password) the moment they accept — but the
  // signup trigger always creates their profile as role 'staff' with no
  // store. Rather than let them into the app on an unassigned account
  // (where most pages assume a current store and either error or, worse,
  // silently show nothing useful), hold them here until an Admin sets
  // their store in User Management. Admins are exempt: an admin
  // genuinely can be store-less and still meant to see everything.
  if (profile.role !== 'admin' && !profile.primary_store_id) {
    return <PendingStoreAssignment onSignOut={signOut} />
  }

  return children
}

function PendingStoreAssignment({ onSignOut }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand-50/60 px-4 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
        OT
      </div>
      <h1 className="text-lg font-semibold text-brand-900">Almost there</h1>
      <p className="max-w-sm text-sm text-gray-600">
        Your account is set up, but an Admin hasn't assigned you to a store yet. Once they do (Admin Center &gt;
        User Management), come back to this page and you'll see your store's content.
      </p>
      <button onClick={onSignOut} className="text-sm text-brand-600 hover:underline">
        Sign out
      </button>
    </div>
  )
}
