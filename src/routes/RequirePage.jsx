import { useAuth } from '../lib/AuthContext'
import { canAccessPage } from '../lib/permissions'

export default function RequirePage({ pageKey, children }) {
  const { effectivePages } = useAuth()
  if (!canAccessPage(effectivePages, pageKey)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        You don't have access to this page. Ask an Admin to grant access in Admin Center &gt; User Management.
      </div>
    )
  }
  return children
}
