import { supabase } from '../../lib/supabaseClient'
import { BRISBANE_UTC_OFFSET_HOURS } from '../../lib/brisbaneTime'

// Today's date in Brisbane as YYYY-MM-DD (Brisbane is a fixed UTC+10, no DST).
export function brisbaneToday() {
  return new Date(Date.now() + BRISBANE_UTC_OFFSET_HOURS * 3600 * 1000).toISOString().slice(0, 10)
}

export function formatAuditDate(dateStr) {
  if (!dateStr) return ''
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatAuditDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Australia/Brisbane',
  })
}

// Public URL of a File Repository file (documents bucket).
export function auditFileUrl(filePath) {
  return filePath ? supabase.storage.from('documents').getPublicUrl(filePath).data.publicUrl : null
}

export function isAuditAdmin(profile) {
  return profile?.role === 'admin' || profile?.role === 'developer'
}

// DB rows -> the shape AuditSheet renders / edits.
export function reportToSheetData(report) {
  return {
    id: report.id,
    status: report.status,
    audit_date: report.audit_date,
    items: [...(report.audit_report_items ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((it) => ({
        title: it.title,
        content: it.content,
        files: Array.isArray(it.files) ? it.files : [],
        comment: it.comment ?? '',
        audited: !!it.audited,
      })),
    meeting_summary: report.meeting_summary ?? '',
    auditor_name: report.auditor_name ?? '',
    auditor_signature: report.auditor_signature ?? null,
    confirmed_by_name: report.confirmed_by_name,
    manager_signature: report.manager_signature,
    confirmed_at: report.confirmed_at,
  }
}
