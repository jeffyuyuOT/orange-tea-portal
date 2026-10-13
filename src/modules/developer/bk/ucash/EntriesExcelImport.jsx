import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { markLedgerDuplicates, parseLedgerRows, readWorkbookRows } from '../bkImport'
import { bulkImportLedgerRows, listEntries } from '../bkData'
import { ENTRY_KIND_LABELS, RUJU_TARGET_LABELS, fmtMoney } from '../bkUtils'
import { Notice } from '../bkUi'

const KIND_LABEL = { ...ENTRY_KIND_LABELS, transfer: '分店transfer' }

// Point 5: backfill 收支 (icost / ucost / 其他收入 / deposit / withdraw / 入金 /
// 分店transfer) from Excel. Unlike Sales figure / 分店現金 this writes
// straight to the database (收支 rows are append-only records, not a sheet),
// so duplicates are skipped by default and can't be force-overwritten —
// importing the same file twice never creates double entries.
export default function EntriesExcelImport({ file, stores, defaultStoreId, sheetNames, onImported, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sheet = await readWorkbookRows(await file.arrayBuffer(), { sheetNames })
        const parsed = parseLedgerRows(sheet.rows, { stores, defaultStoreId })
        if (parsed.error || parsed.rows.length === 0) {
          if (!cancelled) setState({ result: parsed, sheetName: sheet.name })
          return
        }
        const dated = parsed.rows.filter((r) => r.date)
        const from = dated.reduce((a, r) => (r.date < a ? r.date : a), dated[0]?.date ?? '9999-99-99')
        const to = dated.reduce((a, r) => (r.date > a ? r.date : a), dated[0]?.date ?? '0000-00-00')
        const existing = dated.length ? await listEntries({ storeId: null, from, to }) : []
        const rows = markLedgerDuplicates(parsed.rows, existing)
        if (!cancelled) setState({ result: { ...parsed, rows }, sheetName: sheet.name })
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, stores, defaultStoreId, sheetNames])

  const { result } = state
  const { importable, duplicates, problems } = useMemo(() => {
    const rows = result?.rows ?? []
    return {
      importable: rows.filter((r) => !r.problem && !r.duplicate),
      duplicates: rows.filter((r) => !r.problem && r.duplicate),
      problems: rows.filter((r) => r.problem),
    }
  }, [result])

  async function apply() {
    setImporting(true)
    setError('')
    try {
      await bulkImportLedgerRows(importable)
      onImported?.(importable.length)
    } catch (e) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  const describe = (r) => {
    if (r.kind === 'transfer') {
      const fromName = stores.find((s) => s.id === r.fromStoreId)?.name ?? ''
      const toName = stores.find((s) => s.id === r.toStoreId)?.name ?? ''
      return `${fromName} → ${toName}${r.mode === 'loan_repay' ? '（借貸償還）' : ''}`
    }
    const storeName = stores.find((s) => s.id === r.storeId)?.name ?? ''
    if (r.kind === 'ruju') return `${storeName} · ${RUJU_TARGET_LABELS[r.rujuTarget] ?? ''}`
    return `${storeName}${r.description ? ` · ${r.description}` : ''}`
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="匯入 Excel — 收支"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {importable.length > 0 ? '取消' : '關閉'}
          </Button>
          <Button disabled={importable.length === 0 || importing} onClick={apply}>
            {importing ? '匯入中…' : `匯入 ${importable.length} 筆`}
          </Button>
        </>
      }
    >
      {state.loading && <LoadingSpinner label="讀取檔案…" />}
      {state.failed && <Notice kind="error">{state.failed}</Notice>}
      {result?.error && <Notice kind="error">{result.error}</Notice>}
      {result && !result.error && (
        <div className="space-y-3 text-sm">
          <div className="text-gray-500">
            檔案：{file.name}
            {state.sheetName ? `（工作表：${state.sheetName}）` : ''}
          </div>
          <Notice kind="info">
            需要 Date / Type / Amount 欄（分店transfer 需要 From / To 分店欄）。已經在系統裡的紀錄（分店 + 日期 + 種類 + 金額都相同）會自動跳過，不會重複匯入。
          </Notice>

          {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

          {importable.length === 0 && duplicates.length === 0 && problems.length === 0 ? (
            <Notice kind="error">這個檔案裡沒有可以匯入的資料。</Notice>
          ) : (
            <Notice kind="ok">
              可匯入 {importable.length} 筆。
              {duplicates.length > 0 && <span className="ml-1">{duplicates.length} 筆系統已經有相同紀錄，已跳過。</span>}
              {problems.length > 0 && <span className="ml-1 text-red-600">{problems.length} 筆看不懂，已跳過。</span>}
            </Notice>
          )}

          {importable.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-brand-100">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-100 text-left text-xs text-gray-700">
                  <tr>
                    <th className="px-3 py-2">日期</th>
                    <th className="px-3 py-2">種類</th>
                    <th className="px-3 py-2">內容</th>
                    <th className="px-3 py-2 text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {importable.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                      <td className="px-3 py-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                      <td className="px-3 py-2">{describe(r)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {problems.length > 0 && (
            <div>
              <div className="mb-1 font-semibold text-brand-900">看不懂的列（{problems.length}）</div>
              <ul className="space-y-1">
                {problems.map((r) => (
                  <li key={r.rowNumber} className="rounded bg-red-50 px-2 py-1">
                    第 {r.rowNumber} 列{r.date ? `（${r.date}）` : ''} — {r.problem}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.ignored.length > 0 && (
            <div>
              <div className="mb-1 font-semibold text-brand-900">不會匯入的欄位（{result.ignored.length}）</div>
              <ul className="space-y-1">
                {result.ignored.map((m) => (
                  <li key={m.header} className="rounded bg-gray-50 px-2 py-1">
                    {m.header} <span className="text-gray-400">— {m.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
