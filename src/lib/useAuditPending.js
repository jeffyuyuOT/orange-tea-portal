import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { canAccessPage } from './permissions'

// Jeff, 2026-10-18: red dot on Audit > Review for a shop manager when an
// audit at one of their stores is waiting for their signature. Only queried
// for someone who actually has the page AND is a shop manager — everyone
// else (staff, training, …) never touches audit data at login.
//
// Extracted from Sidebar.jsx's own inline version (2026-10-20, point 7) so
// SectionTabLayout/MobileSectionHome can show the exact same signal on the
// new mobile tab bar/section grid without a second, driftable copy of this
// query living in another component.
export function useAuditPending(profile, effectivePages) {
  const { pathname } = useLocation()
  const [auditPending, setAuditPending] = useState(false)
  const watchAudit = profile?.role === 'shop_manager' && canAccessPage(effectivePages, 'audit.review')
  useEffect(() => {
    if (!watchAudit) {
      setAuditPending(false)
      return undefined
    }
    let cancelled = false
    const check = () =>
      supabase
        .from('audit_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_confirmation')
        .then(({ count }) => {
          if (!cancelled) setAuditPending((count ?? 0) > 0)
        })
    check()
    window.addEventListener('audit-changed', check)
    return () => {
      cancelled = true
      window.removeEventListener('audit-changed', check)
    }
  }, [watchAudit, pathname])
  return auditPending
}
