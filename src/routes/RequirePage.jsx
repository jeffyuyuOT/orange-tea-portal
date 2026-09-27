import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { canAccessPage } from '../lib/permissions'
import { firstAccessiblePagePath } from '../lib/sidebarOrder'

// Jeff: a first-time (or newly reassigned) user who lands on a page their
// role/overrides don't cover used to just see the static "you don't have
// access" message below and stay there — if they never thought to click a
// different tab themselves, "they'd think the site is broken." This used
// to only ever happen at "/" (handled separately by RootRedirect in
// routes.jsx), but the exact same thing happens on ANY guarded route: a
// stale bookmark, a link someone shared, a page an admin override used to
// grant that's since been revoked. So this now does the same thing
// RootRedirect does — send them straight to a page they DO have access to
// — for every guarded route, not just the root one. The static message is
// now only ever reached if there's truly nowhere else to send them.
export default function RequirePage({ pageKey, children }) {
  const { effectivePages, sidebarOrder } = useAuth()
  const location = useLocation()

  if (!canAccessPage(effectivePages, pageKey)) {
    const fallbackPath = firstAccessiblePagePath(effectivePages, sidebarOrder)
    if (fallbackPath && fallbackPath !== location.pathname) {
      return <Navigate to={fallbackPath} replace />
    }
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        You don't have access to this page. Ask an Admin to grant access in Admin Center &gt; User Management.
      </div>
    )
  }
  return children
}
