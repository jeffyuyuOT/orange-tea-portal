import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { rosterDisplayName } from '../../lib/excelRoster'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import LoadingSpinner, { EmptyState } from '../../components/ui/LoadingSpinner'
import SignaturePad from './SignaturePad'
import AuditSheet from './AuditSheet'
import { brisbaneToday, formatAuditDate, formatAuditDateTime, isAuditAdmin, reportToSheetData } from './auditUtils'

export const AUDIT_CHANGED_EVENT = 'audit-changed'

export default function AuditReviewPage() {
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const isAdmin = isAuditAdmin(profile)
  const isManager = profile?.role === 'shop_manager'
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? ''

  const [reports, setReports] = useState(null) // null = loading
  const [editing, setEditing] = useState(null) // admin: sheet data being filled in
  const [viewing, setViewing] = useState(null) // report row being looked at
  const [managerSignature, setManagerSignature] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!currentStoreId) return
    const { data, error: err } = await supabase
      .from('audit_reports')
      .select('*, audit_report_items(*)')
      .eq('store_id', currentStoreId)
      .in('status', ['draft', 'pending_confirmation'])
      .order('audit_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    setReports(data ?? [])
  }, [currentStoreId])

  // Switching store drops whatever was open — it belonged to the old store.
  useEffect(() => {
    setEditing(null)
    setViewing(null)
    setManagerSignature(null)
    setError('')
    setNotice('')
    setReports(null)
    load()
  }, [load])

  // ---- admin: create / edit / submit --------------------------------------
  async function startNewAudit() {
    setError('')
    setNotice('')
    const { data: items, error: err } = await supabase
      .from('audit_items')
      .select('*')
      .eq('store_id', currentStoreId)
      .order('sort_order')
    if (err) return setError(err.message)
    if (!items?.length) return setError('There are no audit items for this store yet. Add some in Audit > Settings first.')
    setEditing({
      id: null,
      audit_date: brisbaneToday(),
      items: items.map((it) => ({
        title: it.title,
        content: it.content,
        file_path: it.file_path,
        file_name: it.file_name,
        comment: '',
        audited: false,
      })),
      meeting_summary: '',
      auditor_name: '',
      auditor_signature: null,
    })
  }

  async function persist(status) {
    setError('')
    const base = {
      store_id: currentStoreId,
      audit_date: editing.audit_date,
      meeting_summary: editing.meeting_summary || null,
      auditor_name: editing.auditor_name.trim() || null,
      auditor_signature: editing.auditor_signature,
      status,
      submitted_at: status === 'pending_confirmation' ? new Date().toISOString() : null,
    }
    let id = editing.id
    if (id) {
      const { error: err } = await supabase.from('audit_reports').update(base).eq('id', id)
      if (err) return setError(err.message)
      const { error: delErr } = await supabase.from('audit_report_items').delete().eq('report_id', id)
      if (delErr) return setError(delErr.message)
    } else {
      const { data, error: err } = await supabase
        .from('audit_reports')
        .insert({ ...base, created_by: profile.id })
        .select('id')
        .single()
      if (err) return setError(err.message)
      id = data.id
    }
    const rows = editing.items.map((it, i) => ({
      report_id: id,
      title: it.title,
      content: it.content,
      file_path: it.file_path,
      file_name: it.file_name,
      comment: it.comment || null,
      audited: it.audited,
      sort_order: i,
    }))
    const { error: itemsErr } = await supabase.from('audit_report_items').insert(rows)
    if (itemsErr) {
      // Keep the id so the next Save updates this row instead of inserting a duplicate.
      setEditing((e) => ({ ...e, id }))
      return setError(itemsErr.message)
    }
    return id
  }

  async function saveDraft() {
    const id = await persist('draft')
    if (!id) return
    setEditing(null)
    setNotice('Draft saved.')
    await load()
  }

  async function submitAudit() {
    if (!editing.auditor_name.trim() || !editing.auditor_signature) return
    if (!window.confirm('Submit this audit to the shop managers for confirmation? You will not be able to edit it afterwards.')) return
    const id = await persist('pending_confirmation')
    if (!id) return
    setEditing(null)
    setNotice('Audit submitted. Shop managers at this store can now review and sign it.')
    window.dispatchEvent(new Event(AUDIT_CHANGED_EVENT))
    await load()
  }

  async function deleteDraft() {
    if (!editing.id || !window.confirm('Delete this draft audit?')) return
    const { error: err } = await supabase.from('audit_reports').delete().eq('id', editing.id)
    if (err) return setError(err.message)
    setEditing(null)
    await load()
  }

  // ---- shop manager: confirm ----------------------------------------------
  async function confirmAudit() {
    if (!managerSignature) return
    setError('')
    const { error: err } = await supabase.rpc('confirm_audit_report', {
      p_report_id: viewing.id,
      p_signature: managerSignature,
      p_name: rosterDisplayName(profile) || profile.email || null,
    })
    if (err) return setError(err.message)
    setViewing(null)
    setManagerSignature(null)
    setNotice('Audit confirmed. You can find it in History.')
    window.dispatchEvent(new Event(AUDIT_CHANGED_EVENT))
    await load()
  }

  // ---- render -------------------------------------------------------------
  const errorBanner = error && (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
  )

  if (editing) {
    const canSubmit = !!editing.auditor_name.trim() && !!editing.auditor_signature
    return (
      <div>
        <button className="mb-3 text-sm font-medium text-brand-600 hover:text-brand-800" onClick={() => setEditing(null)}>
          ‹ Back
        </button>
        <h1 className="mb-4 text-xl font-semibold text-gray-900">{editing.id ? 'Edit draft audit' : 'New audit'}</h1>
        {errorBanner}
        <AuditSheet
          key={editing.id ?? 'new'}
          data={editing}
          editable
          storeName={storeName}
          onChange={(patch) => setEditing((e) => ({ ...e, ...patch }))}
        />
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={saveDraft}>
            Save draft
          </Button>
          <Button onClick={submitAudit} disabled={!canSubmit}>
            Submit
          </Button>
          {editing.id && (
            <Button variant="danger" onClick={deleteDraft}>
              Delete draft
            </Button>
          )}
          {!canSubmit && <span className="text-xs text-gray-400">Enter the auditor&apos;s name and sign to enable Submit.</span>}
        </div>
      </div>
    )
  }

  if (viewing) {
    const canConfirm = isManager && viewing.status === 'pending_confirmation'
    return (
      <div>
        <button
          className="mb-3 text-sm font-medium text-brand-600 hover:text-brand-800"
          onClick={() => {
            setViewing(null)
            setManagerSignature(null)
            setError('')
          }}
        >
          ‹ Back
        </button>
        <h1 className="mb-4 text-xl font-semibold text-gray-900">Audit · {formatAuditDate(viewing.audit_date)}</h1>
        {errorBanner}
        <AuditSheet data={reportToSheetData(viewing)} storeName={storeName} />

        {canConfirm ? (
          <div className="mt-6 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
            <div className="mb-1 text-sm font-semibold text-gray-900">Shop manager confirmation</div>
            <p className="mb-3 text-sm text-gray-500">
              Confirming as <span className="font-medium text-gray-700">{rosterDisplayName(profile) || profile.email}</span>. Please sign
              below to confirm you have read this audit.
            </p>
            <SignaturePad onChange={setManagerSignature} />
            <div className="mt-4">
              <Button onClick={confirmAudit} disabled={!managerSignature}>
                Confirm
              </Button>
            </div>
          </div>
        ) : (
          viewing.status === 'pending_confirmation' && (
            <p className="mt-6 text-sm text-gray-500">Waiting for a shop manager at this store to confirm.</p>
          )
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">Audit Review</h1>
        {isAdmin && <Button onClick={startNewAudit}>+ New audit</Button>}
      </div>
      <p className="mb-4 text-sm text-gray-500">
        {isAdmin
          ? 'Audits in progress or waiting for the shop manager to confirm.'
          : 'Audits waiting for your confirmation. Once confirmed they move to History.'}
      </p>
      {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{notice}</div>}
      {errorBanner}

      {reports === null ? (
        <LoadingSpinner />
      ) : !reports.length ? (
        <EmptyState label="No audits to review right now." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setError('')
                setNotice('')
                if (r.status === 'draft') setEditing(reportToSheetData(r))
                else setViewing(r)
              }}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-800">{formatAuditDate(r.audit_date)}</span>
                {r.status === 'draft' ? (
                  <Badge color="gray">Draft</Badge>
                ) : (
                  <Badge color="red">{isManager ? 'Needs your confirmation' : 'Awaiting manager'}</Badge>
                )}
                {r.auditor_name && <span className="text-xs text-gray-400">Auditor: {r.auditor_name}</span>}
                {r.submitted_at && <span className="text-xs text-gray-400">Submitted {formatAuditDateTime(r.submitted_at)}</span>}
              </span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
