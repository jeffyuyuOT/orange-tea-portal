import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import {
  filterKeepExisting,
  filterKeepExistingCashDays,
  parseCashDayRows,
  parseSfRows,
  readWorkbookRows,
} from '../bkImport'
import { loadCashMonth, loadPaymentTypes, loadSfMonth, saveCashDays, saveSfMonth } from '../bkData'
import { brisbaneToday, buildColumns, cashDaysFromRows, monthLabel, sfDaysFromRows } from '../bkUtils'
import { Notice, StoreTabs, YearMonthPicker } from '../bkUi'

const LABEL = { sf: 'SF', cashday: 'U帳 > 分店現金' }

// 系統設置 > 匯入's SF / 分店現金 pipeline: both are per-store, per-month grids,
// so unlike 收支/分紅/積欠 this needs a Store + 年月 picker before it can even
// read the file against the right existing data. Writes straight to the
// database (this is a backfill tool, not the live sheet — no separate 儲存
// step), reusing the exact same load/save functions and keep-existing-by-
// default rule as each page's own 匯入 Excel.
export default function BackfillGridImport({ file, kind, stores, sheetNames, onImported, onClose }) {
  const t = brisbaneToday()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const [year, setYear] = useState(t.year)
  const [month, setMonth] = useState(t.month)
  const [state, setState] = useState({ loading: true })
  const [overwrite, setOverwrite] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    setState({ loading: true })
    ;(async () => {
      try {
        const sheet = await readWorkbookRows(await file.arrayBuffer(), { sheetNames })
        if (kind === 'sf') {
          const types = await loadPaymentTypes(storeId)
          const columns = buildColumns(types)
          const result = parseSfRows(sheet.rows, { year, month, columns })
          const existing = await loadSfMonth(storeId, year, month)
          const days = sfDaysFromRows(existing.days)
          if (!cancelled) setState({ result, sheetName: sheet.name, existing, days })
        } else {
          const result = parseCashDayRows(sheet.rows, { year, month })
          const existing = await loadCashMonth(storeId, year, month)
          const days = cashDaysFromRows(existing.cashDays)
          if (!cancelled) setState({ result, sheetName: sheet.name, existing, days })
        }
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, kind, storeId, year, month, sheetNames])

  const { result, days } = state
  const kept = useMemo(() => {
    if (!result || !days) return { entries: {}, skipped: 0 }
    return kind === 'sf' ? filterKeepExisting(result.entries, days) : filterKeepExistingCashDays(result.entries, days)
  }, [result, days, kind])
  const toApply = overwrite ? result?.entries : kept.entries
  const canApply = !!result && !result.error && Object.keys(toApply ?? {}).length > 0

  async function apply() {
    setApplying(true)
    setError('')
    try {
      if (kind === 'sf') {
        const merged = { ...days }
        for (const [date, entry] of Object.entries(toApply)) {
          const cur = merged[date] ?? { o_ca: '', o_post: '', total: '', amounts: {} }
          const amounts = { ...cur.amounts, ...(entry.amounts ?? {}) }
          merged[date] = {
            ...cur,
            o_ca: entry.o_ca !== undefined ? entry.o_ca : cur.o_ca,
            o_post: entry.o_post !== undefined ? entry.o_post : cur.o_post,
            amounts,
          }
        }
        await saveSfMonth({ storeId, year, month, existing: state.existing.sfMonth, days: merged, submit: false })
      } else {
        const merged = { ...days }
        for (const [date, entry] of Object.entries(toApply)) merged[date] = { ...(merged[date] ?? { actual_ca: '', d_amount: '', d_stocked: false }), ...entry }
        await saveCashDays(storeId, merged)
      }
      onImported?.(Object.keys(toApply).length)
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
      title={`匯入 Excel — ${LABEL[kind]} ${monthLabel(year, month)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {canApply ? '取消' : '關閉'}
          </Button>
          <Button disabled={!canApply || applying} onClick={apply}>
            {applying ? '匯入中…' : `套用 ${Object.keys(toApply ?? {}).length} 天`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} />
          <YearMonthPicker year={year} month={month} onChange={(v) => { if (v.year) setYear(v.year); if (v.month) setMonth(v.month) }} />
        </div>
        <Notice kind="info">
          這裡直接寫入資料庫（不像分店現金/SF頁面需要再按「儲存」）— 請先選對分店跟月份，檔案裡的日期要落在這個月份內才會匯入。
        </Notice>

        {state.loading && <LoadingSpinner label="讀取檔案…" />}
        {state.failed && <Notice kind="error">{state.failed}</Notice>}
        {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
        {result?.error && <Notice kind="error">{result.error}</Notice>}

        {result && !result.error && (
          <>
            <div className="text-gray-500">
              檔案：{file.name}
              {state.sheetName ? `（工作表：${state.sheetName}）` : ''}
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-700">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              覆蓋資料庫現有的數字（預設不覆蓋：已經有數字的格子會跳過）
            </label>
            {result.dayCount > 0 ? (
              <Notice kind="ok">
                可匯入 {result.dayCount} 天、{result.cellCount} 個數字。
                {!overwrite && kept.skipped > 0 && <span className="ml-1">其中 {kept.skipped} 格資料庫已經有數字，不會匯入。</span>}
              </Notice>
            ) : (
              <Notice kind="error">這個檔案裡沒有屬於 {monthLabel(year, month)} 的可匯入資料。</Notice>
            )}
            {result.otherMonths.length > 0 && (
              <Notice kind="info">
                檔案裡有其他月份的資料（{result.otherMonths.join('、')}）沒有匯入。請切換到對應年月再匯入一次。
              </Notice>
            )}
            {result.unreadable > 0 && <Notice kind="info">有 {result.unreadable} 列的日期看不懂，已略過。</Notice>}
            {result.badCells > 0 && <Notice kind="info">有 {result.badCells} 格不是數字，已略過。</Notice>}
          </>
        )}
      </div>
    </Modal>
  )
}
