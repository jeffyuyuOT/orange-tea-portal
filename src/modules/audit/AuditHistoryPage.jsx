import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import LoadingSpinner, { EmptyState } from '../../components/ui/LoadingSpinner'
import { useAuditStore } from './useAuditStore'
import AuditSheet from './AuditSheet'
import { formatAuditDate, reportToSheetData } from './auditUtils'

export default function AuditHistoryPage() {
  const { storeId: currentStoreId, storeName, hasAuditStores } = useAuditStore()
  const [reports, setReports] = useState(null) // null = loading
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentStoreId) return
    setReports(null)
    setSelected(null)
    setError('')
    supabase
      .from('audit_reports')
      .select('*, audit_report_items(*)')
      .eq('store_id', currentStoreId)
      .eq('status', 'completed')
      .order('audit_date', { ascending: false })
      .order('confirmed_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        setReports(data ?? [])
      })
  }, [currentStoreId])

  if (!hasAuditStores) return <EmptyState label="Audit isn't switched on for any of your stores." />

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Audit History</h1>
      <p className="mb-4 text-sm text-gray-500">Confirmed audits for this store, newest first.</p>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {reports === null ? (
        <LoadingSpinner />
      ) : !reports.length ? (
        <EmptyState label="No completed audits yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {reports.map((r) => {
            const done = r.audit_report_items.filter((i) => i.audited).length
            return (
              <button
                key={r.id}
                onClick={() => setSelected(r)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-50"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">{formatAuditDate(r.audit_date)}</span>
                  <Badge color={done === r.audit_report_items.length ? 'green' : 'gray'}>
                    {done}/{r.audit_report_items.length} audited
                  </Badge>
                  {r.auditor_name && <span className="text-xs text-gray-400">Auditor: {r.auditor_name}</span>}
                  {r.confirmed_by_name && <span className="text-xs text-gray-400">Confirmed by {r.confirmed_by_name}</span>}
                </span>
                <span className="text-gray-300">›</span>
              </button>
            )
          })}
        </div>
      )}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        extraWide
        title={selected ? `Audit · ${formatAuditDate(selected.audit_date)}` : ''}
      >
        {selected && <AuditSheet data={reportToSheetData(selected)} storeName={storeName} />}
      </Modal>
    </div>
  )
}
