// "匯入 by 圖檔", reading step 1: ask the receipt scan service (through the
// scan-pos-report edge function, which holds the API key) to read the screenshot.
// Its result is turned into the same "draft" the review step edits.
import { supabase } from '../../../lib/supabaseClient'

// service result -> draft ({ date, dateTo, lines: [{ label, amount: string }], total, fixed, hadTotal, ... })
export function serviceResultToDraft(r) {
  const payments = Array.isArray(r?.payments) ? r.payments : []
  return {
    date: r?.date ?? '',
    dateTo: String(r?.period?.to ?? '').slice(0, 10),
    lines: payments.map((p) => ({ label: String(p.method ?? ''), amount: String(p.amount ?? '') })),
    total: r?.total === null || r?.total === undefined ? '' : String(r.total),
    fixed: r?.fixed ? { label: r.fixed.method, from: r.fixed.from, to: r.fixed.to } : null,
    hadTotal: r?.total !== null && r?.total !== undefined,
    strategy: r?.strategy ?? '',
    source: 'service',
  }
}

// file (image Blob) -> draft. Throws when the service cannot be reached or refuses.
export async function scanReportViaService(file) {
  const body = new FormData()
  body.append('file', file, file.name || 'report.png')
  const { data, error } = await supabase.functions.invoke('scan-pos-report', { body })
  if (error) {
    // FunctionsHttpError carries the response; show the function's own message when there is one
    let detail = ''
    try {
      detail = (await error.context?.json?.())?.error ?? ''
    } catch {
      /* no body */
    }
    throw new Error(detail || error.message || 'scan service unavailable')
  }
  if (data?.error) throw new Error(data.error)
  return serviceResultToDraft(data)
}
