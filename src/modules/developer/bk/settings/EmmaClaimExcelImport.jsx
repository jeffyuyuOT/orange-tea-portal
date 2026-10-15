import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { buildEmmaClaims, linkEmmaDetailToEntries, markEmmaClaimDuplicates, parseEmmaClaimRows, readWorkbookRows } from '../bkImport'
import { bulkImportEmmaClaimRows, loadEmmaCandidateEntries, loadEmmaClaims, loadStores } from '../bkData'
import { fmtMoney } from '../bkUtils'
import { Notice } from '../bkUi'

// 系統設置 > 匯入 — 積欠 Emma. Each imported row becomes one historical claim
// (submitted date + total amount); it carries no underlying 入金 rows since
// those only exist for claims actually built in the system. Direct-to-DB,
// dedupe-by-default (same 提交日期 + 金額 is skipped) like the other ledgers.
const TARGET_LABELS = { jeff_bank: 'Jeff B', mao_safe: 'Mao保', other: '其他' }

export default function EmmaClaimExcelImport({ file, onImported, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sheet = await readWorkbookRows(await file.arrayBuffer())
        const parsed = parseEmmaClaimRows(sheet.rows)
        if (parsed.error || parsed.rows.length === 0) {
          if (!cancelled) setState({ result: parsed, sheetName: sheet.name })
          return
        }
        const [existing, stores] = await Promise.all([loadEmmaClaims(), loadStores()])
        const sunnybank = stores.find((s) => s.name === 'Sunnybank')
        const candidates = sunnybank && parsed.detailMode ? await loadEmmaCandidateEntries(sunnybank.id) : []
        const problemRows = parsed.rows.filter((r) => r.problem)
        const claims = markEmmaClaimDuplicates(linkEmmaDetailToEntries(buildEmmaClaims(parsed.rows), candidates, existing), existing)
        if (!cancelled) setState({ result: { ...parsed, rows: [...claims, ...problemRows] }, sheetName: sheet.name })
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

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
      await bulkImportEmmaClaimRows(importable)
      onImported?.(importable.length)
    } catch (e) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="匯入 Excel — 積欠 Emma"
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
            入金明細：每一列是一筆入金（Date、入金日期、入金金額、入金對象），Date 相同的列會合成一筆 bonus 紀錄，Bonus = 入金總和的 10%。舊格式（Date / Amount）也還能用，但沒有入金明細。已經在系統裡的紀錄（提交日期 + Bonus 金額都相同）會自動跳過；跟系統裡既有入金對得上的明細會自動對應。
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
                    <th className="px-3 py-2">提交日期</th>
                    <th className="px-3 py-2">入金明細</th>
                    <th className="px-3 py-2 text-right">Bonus 金額</th>
                  </tr>
                </thead>
                <tbody>
                  {importable.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                      <td className="px-3 py-2">
                        {r.detail ? (
                          <ul className="space-y-0.5">
                            {r.detail.map((d, i) => (
                              <li key={i} className="whitespace-nowrap text-xs">
                                {d.entry_date} · {fmtMoney(d.amount)} · {TARGET_LABELS[d.target] ?? d.target}
                                {d.entry_id ? <span className="ml-1 text-green-700">（對應到系統入金）</span> : null}
                                {d.note ? <span className="ml-1 text-gray-500">{d.note}</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          r.note || ''
                        )}
                      </td>
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
