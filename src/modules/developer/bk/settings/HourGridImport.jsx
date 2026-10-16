import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { readWorkbookRows } from '../bkImport'
import { fmtMoney, round2 } from '../bkUtils'
import { saveCombinedHours } from '../bkHourData'
import { hourLabel, parseHourGridRows } from '../bkHourly'
import { sheetNameForStore } from '../bkImportTemplates'
import { Notice } from '../bkUi'

// 系統設置 › 匯入 › 小時統計: reads the tab named after each SF / U帳 store (the
// template has one tab per store; rows = dates, columns = hours, already-summed
// 營業額) and writes straight to the database, all dates found.
export default function HourGridImport({ file, stores, onImported, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const buf = await file.arrayBuffer()
        const jobs = []
        const notFound = []
        const broken = []
        for (const store of stores) {
          const sheetName = sheetNameForStore(store.name)
          const sheet = await readWorkbookRows(buf, { sheetNames: [sheetName] })
          if (sheet.name !== sheetName) {
            notFound.push(store.name)
            continue
          }
          const parsed = parseHourGridRows(sheet.rows)
          if (parsed.error) broken.push({ name: store.name, error: parsed.error })
          else if (Object.keys(parsed.days).length > 0) jobs.push({ key: store.id, store, ...parsed })
        }
        if (!cancelled) setState({ jobs, notFound, broken })
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, stores])

  const jobs = state.jobs ?? []
  const summary = useMemo(
    () =>
      jobs.map((j) => {
        const dates = Object.keys(j.days).sort()
        const total = round2(dates.reduce((s, d) => s + Object.values(j.days[d]).reduce((a, b) => a + b, 0), 0))
        return { key: j.key, dates, total }
      }),
    [jobs]
  )
  const totalDays = summary.reduce((n, s) => n + s.dates.length, 0)
  const unreadable = jobs.reduce((n, j) => n + j.unreadable, 0)
  const badCells = jobs.reduce((n, j) => n + j.badCells, 0)
  const ignored = [...new Set(jobs.flatMap((j) => j.ignored))]

  async function apply() {
    setApplying(true)
    setError('')
    try {
      for (const j of jobs) await saveCombinedHours(j.store.id, j.days)
      onImported?.(totalDays)
    } catch (e) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="匯入 Excel — 小時統計"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {totalDays > 0 ? '取消' : '關閉'}
          </Button>
          <Button disabled={totalDays === 0 || applying} onClick={apply}>
            {applying ? '匯入中…' : `套用 ${totalDays} 天`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Notice kind="info">
          這裡直接寫入資料庫。每個分店會讀檔案裡同名的工作表（列 = 日期，欄 = 小時，數字是 POS 和自動點單已經加總的營業額）。同一天重新匯入會取代之前匯入的加總數字；已經有 POS／自動點單資料的小時，畫面上會以 POS＋自動點單 為準。
        </Notice>
        {state.loading && <LoadingSpinner label="讀取檔案…" />}
        {state.failed && <Notice kind="error">{state.failed}</Notice>}
        {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
        {!state.loading && !state.failed && (
          <>
            <div className="text-gray-500">檔案：{file.name}</div>
            {state.notFound?.length > 0 && <Notice kind="info">檔案裡沒有找到「{state.notFound.join('、')}」的分頁，這些分店沒有被匯入。</Notice>}
            {state.broken?.length > 0 && <Notice kind="error">{state.broken.map((b) => `「${b.name}」：${b.error}`).join('；')}</Notice>}
            {jobs.length === 0 ? (
              <Notice kind="error">這個檔案裡沒有看得懂的可匯入資料。</Notice>
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-brand-100">
                  <table className="min-w-full text-sm">
                    <thead className="bg-brand-100 text-left text-xs text-gray-700">
                      <tr>
                        <th className="px-3 py-2">分店</th>
                        <th className="px-3 py-2">日期範圍</th>
                        <th className="px-3 py-2">小時</th>
                        <th className="px-3 py-2 text-right">天數</th>
                        <th className="px-3 py-2 text-right">營業額合計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j, i) => (
                        <tr key={j.key} className="border-t border-gray-100">
                          <td className="px-3 py-2">{j.store.name}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {summary[i].dates[0]} ~ {summary[i].dates[summary[i].dates.length - 1]}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {hourLabel(j.hours[0])}–{hourLabel(j.hours[j.hours.length - 1])}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{summary[i].dates.length}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(summary[i].total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ignored.length > 0 && <Notice kind="info">不會匯入的欄位：{ignored.join('、')}</Notice>}
                {unreadable > 0 && <Notice kind="info">有 {unreadable} 列的日期看不懂（需要完整日期，例如 2026-10-05），已略過。</Notice>}
                {badCells > 0 && <Notice kind="info">有 {badCells} 格不是數字，已略過。</Notice>}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
