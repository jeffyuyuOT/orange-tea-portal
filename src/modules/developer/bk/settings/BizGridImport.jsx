import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { readWorkbookRows } from '../bkImport'
import { brisbaneToday, monthLabel } from '../bkUtils'
import { loadSalesMonth, saveSalesDays } from '../bkSalesData'
import { bizDaysFromRows } from '../bkSalesUtils'
import { filterKeepExistingBiz, parseBizRows } from '../bkSalesImport'
import { sheetNameForStore } from '../bkImportTemplates'
import { Notice } from '../bkUi'

// Every month a sheet has dates for (the file carries its own dates; `fallback`
// only resolves a bare day number), same approach as BackfillGridImport.
function monthsInRows(rows, linked, fallback) {
  const probe = parseBizRows(rows, { year: fallback.year, month: fallback.month, linked })
  if (probe.error) return { error: probe.error, months: [] }
  const months = new Set(probe.otherMonths)
  if (probe.dayCount > 0) months.add(monthLabel(fallback.year, fallback.month))
  return { months: [...months].sort().map((ym) => ({ year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) })) }
}

// 系統設置 > 匯入 > 營業: reads the tab named after each 營業 store (the template
// has one tab per store) and writes straight to the database — all months found,
// all stores, one 套用. Cells that already hold a number are skipped unless 覆蓋.
export default function BizGridImport({ file, salesStores, onImported, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [overwrite, setOverwrite] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const buf = await file.arrayBuffer()
        const fallback = brisbaneToday()
        const jobs = []
        const notFound = []
        const broken = []
        for (const store of salesStores) {
          const sheetName = sheetNameForStore(store.name)
          const sheet = await readWorkbookRows(buf, { sheetNames: [sheetName] })
          if (sheet.name !== sheetName) {
            notFound.push(store.name)
            continue
          }
          const linked = !!store.sf_store_id
          const scan = monthsInRows(sheet.rows, linked, fallback)
          if (scan.error) {
            broken.push({ name: store.name, error: scan.error })
            continue
          }
          for (const { year, month } of scan.months) {
            const result = parseBizRows(sheet.rows, { year, month, linked })
            const days = bizDaysFromRows(await loadSalesMonth(store.id, year, month))
            jobs.push({ key: `${store.id}-${year}-${month}`, store, linked, year, month, result, days })
          }
        }
        if (!cancelled) setState({ jobs, notFound, broken })
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, salesStores])

  const jobs = useMemo(
    () => (state.jobs ?? []).map((j) => ({ ...j, kept: filterKeepExistingBiz(j.result.entries, j.days) })),
    [state.jobs]
  )
  const pick = (j) => (overwrite ? j.result.entries : j.kept.entries)
  const total = jobs.reduce((n, j) => n + Object.keys(pick(j)).length, 0)
  const unreadable = jobs.reduce((n, j) => n + (j.result.unreadable ?? 0), 0)
  const badCells = jobs.reduce((n, j) => n + (j.result.badCells ?? 0), 0)
  const ignoredHeaders = [...new Set(jobs.flatMap((j) => j.result.ignored.map((i) => `${i.header}（${i.reason}）`)))]

  async function apply() {
    setApplying(true)
    setError('')
    try {
      let count = 0
      for (const j of jobs) {
        const entries = pick(j)
        if (Object.keys(entries).length === 0) continue
        const merged = { ...j.days }
        for (const [date, entry] of Object.entries(entries)) {
          const cur = { ...(merged[date] ?? {}) }
          for (const [field, v] of Object.entries(entry)) cur[field] = String(v)
          merged[date] = cur
        }
        // only the imported dates are written, so untouched days stay as they are
        const onlyTouched = Object.fromEntries(Object.keys(entries).map((d) => [d, merged[d]]))
        await saveSalesDays(j.store.id, onlyTouched, { linked: j.linked })
        count += Object.keys(entries).length
      }
      onImported?.(count)
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
      title="匯入 Excel — 營業"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {total > 0 ? '取消' : '關閉'}
          </Button>
          <Button disabled={total === 0 || applying} onClick={apply}>
            {applying ? '匯入中…' : `套用 ${total} 天`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Notice kind="info">
          這裡直接寫入資料庫。每個營業分店會讀檔案裡同名的工作表，檔案裡有幾個月份就匯入幾個月份。總營業額、總杯數由系統計算，不匯入；連結SF的分店 POS 讀SF的 O.POST，POS 欄會略過。營業匯出的「Excel 匯出」檔案也可以直接匯入。
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
                <label className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  覆蓋資料庫現有的數字（預設不覆蓋：已經有數字的格子會跳過）
                </label>
                <div className="overflow-x-auto rounded-xl border border-brand-100">
                  <table className="min-w-full text-sm">
                    <thead className="bg-brand-100 text-left text-xs text-gray-700">
                      <tr>
                        <th className="px-3 py-2">分店</th>
                        <th className="px-3 py-2">月份</th>
                        <th className="px-3 py-2 text-right">可匯入</th>
                        <th className="px-3 py-2 text-right">已有資料（跳過）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr key={j.key} className="border-t border-gray-100">
                          <td className="px-3 py-2">{j.store.name}</td>
                          <td className="px-3 py-2">{monthLabel(j.year, j.month)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Object.keys(pick(j)).length} 天</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{overwrite ? '—' : `${j.kept.skipped} 格`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ignoredHeaders.length > 0 && <Notice kind="info">不會匯入的欄位：{ignoredHeaders.join('、')}</Notice>}
                {unreadable > 0 && <Notice kind="info">有 {unreadable} 列的日期看不懂，已略過。</Notice>}
                {badCells > 0 && <Notice kind="info">有 {badCells} 格不是數字，已略過。</Notice>}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
