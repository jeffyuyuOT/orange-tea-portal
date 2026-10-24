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
  splitCashRowsByStore,
} from '../bkImport'
import { loadCashDays, loadPaymentTypes, loadSfMonth, saveCashDays, saveSfMonth } from '../bkData'
import { brisbaneToday, buildColumns, cashDaysFromRows, monthLabel, sfDaysFromRows } from '../bkUtils'
import { Notice, StoreTabs } from '../bkUi'
import { sheetNameForStore } from '../bkImportTemplates'

const LABEL = { sf: 'SF', cashday: 'U > 分店現金' }

// Every row in these files already carries its own date, so which month(s)
// a sheet covers is read straight off the dates — `fallback` is only used to
// resolve a bare day-number cell with no month of its own (e.g. a hand-
// typed "5"), same as it always was. Probes the sheet once with that
// fallback, then uses its `otherMonths` (every month the probe's own target
// didn't match) plus the target itself (if it had data) to get the full set.
function monthsInRows(parseFn, rows, opts, fallback) {
  const probe = parseFn(rows, { ...opts, year: fallback.year, month: fallback.month })
  if (probe.error) return { error: probe.error, months: [] }
  const months = new Set(probe.otherMonths)
  if (probe.dayCount > 0) months.add(monthLabel(fallback.year, fallback.month))
  return { months: [...months].sort().map((ym) => ({ year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) })) }
}

// 系統設置 > 匯入's SF / 分店現金 pipeline: both write straight to the
// database (this is a backfill tool, not the live sheet — no separate 儲存
// step), reusing the exact same load/save functions and keep-existing-by-
// default rule as each page's own 匯入 Excel.
//
// Neither pipeline asks for a month up front any more — every row already
// has a date, so every month present in the file is detected and applied.
// For kind === 'sf', SF's own downloadable template (bkImportTemplates.js)
// puts every store on its own tab, so every store with a matching tab is
// read and applied in one go too, instead of one store (and one month) at a
// time with a separate 套用 click for each.
export default function BackfillGridImport({ file, kind, stores, sheetNames, onImported, onClose }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null) // cashday only, and only for a file with no Store column
  const [state, setState] = useState({ loading: true })
  const [overwrite, setOverwrite] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState({ loading: true })
    ;(async () => {
      try {
        const buf = await file.arrayBuffer()
        const fallback = brisbaneToday()
        if (kind === 'sf') {
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
            const types = await loadPaymentTypes(store.id)
            const columns = buildColumns(types)
            const scan = monthsInRows(parseSfRows, sheet.rows, { columns }, fallback)
            if (scan.error) {
              broken.push({ name: store.name, error: scan.error })
              continue
            }
            for (const { year, month } of scan.months) {
              const result = parseSfRows(sheet.rows, { year, month, columns })
              const existing = await loadSfMonth(store.id, year, month)
              jobs.push({
                key: `${store.id}-${year}-${month}`,
                storeId: store.id,
                storeName: store.name,
                year,
                month,
                result,
                existing,
                days: sfDaysFromRows(existing.days),
              })
            }
          }
          if (!cancelled) setState({ jobs, notFound, broken })
        } else {
          const sheet = await readWorkbookRows(buf, { sheetNames })
          // The file's own Store column decides the store of every row.
          const split = splitCashRowsByStore(sheet.rows, stores)
          const targets = split.hasStoreColumn
            ? split.groups
            : storeId
              ? [{ store: stores.find((s) => s.id === storeId), rows: sheet.rows }]
              : []
          const jobs = []
          const broken = []
          for (const { store, rows } of targets) {
            const scan = monthsInRows(parseCashDayRows, rows, {}, fallback)
            if (scan.error) {
              broken.push({ name: store.name, error: scan.error })
              continue
            }
            let entries = {}
            let existingRows = []
            for (const { year, month } of scan.months) {
              entries = { ...entries, ...parseCashDayRows(rows, { year, month }).entries }
              existingRows = existingRows.concat(await loadCashDays(store.id, year, month))
            }
            jobs.push({
              key: store.id,
              storeId: store.id,
              storeName: store.name,
              monthText: scan.months.map((m) => monthLabel(m.year, m.month)).join('、'),
              result: { entries },
              days: cashDaysFromRows(existingRows),
            })
          }
          if (!cancelled) setState({ jobs, broken, unknown: split.unknown, needStore: !split.hasStoreColumn, sheetName: sheet.name })
        }
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, kind, storeId, sheetNames, stores])  // eslint-disable-line react-hooks/exhaustive-deps

  // sf: one job per store × month found in the file. cashday: one job per
  // store in the file (all its months merged).
  const jobs = useMemo(
    () =>
      (state.jobs ?? []).map((j) => ({
        ...j,
        kept: kind === 'sf' ? filterKeepExisting(j.result.entries, j.days) : filterKeepExistingCashDays(j.result.entries, j.days),
      })),
    [kind, state.jobs]
  )

  const totalDayCount = jobs.reduce((n, j) => n + Object.keys(j.result.entries).length, 0)
  const totalToApply = jobs.reduce((n, j) => n + Object.keys(overwrite ? j.result.entries : j.kept.entries).length, 0)
  const canApply = jobs.length > 0 && jobs.some((j) => Object.keys(overwrite ? j.result.entries : j.kept.entries).length > 0)
  const totalUnreadable = jobs.reduce((n, j) => n + (j.result.unreadable ?? 0), 0)
  const totalBadCells = jobs.reduce((n, j) => n + (j.result.badCells ?? 0), 0)

  async function apply() {
    setApplying(true)
    setError('')
    try {
      let count = 0
      if (kind === 'sf') {
        for (const j of jobs) {
          const toApply = overwrite ? j.result.entries : j.kept.entries
          if (Object.keys(toApply).length === 0) continue
          const merged = { ...j.days }
          for (const [date, entry] of Object.entries(toApply)) {
            const cur = merged[date] ?? { o_ca: '', o_post: '', total: '', amounts: {} }
            merged[date] = {
              ...cur,
              o_ca: entry.o_ca !== undefined ? entry.o_ca : cur.o_ca,
              o_post: entry.o_post !== undefined ? entry.o_post : cur.o_post,
              amounts: { ...cur.amounts, ...(entry.amounts ?? {}) },
            }
          }
          await saveSfMonth({ storeId: j.storeId, year: j.year, month: j.month, existing: j.existing.sfMonth, days: merged, submit: false })
          count += Object.keys(toApply).length
        }
      } else {
        for (const j of jobs) {
          const toApply = overwrite ? j.result.entries : j.kept.entries
          if (Object.keys(toApply).length === 0) continue
          const merged = { ...j.days }
          for (const [date, entry] of Object.entries(toApply)) {
            merged[date] = { ...(merged[date] ?? { actual_ca: '', d_amount: '', d_stocked: false }), ...entry }
          }
          await saveCashDays(j.storeId, merged)
          count += Object.keys(toApply).length
        }
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
      title={`匯入 Excel — ${LABEL[kind]}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {canApply ? '取消' : '關閉'}
          </Button>
          <Button disabled={!canApply || applying} onClick={apply}>
            {applying ? '匯入中…' : `套用 ${totalToApply} 天`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {kind === 'cashday' && state.needStore && (
          <>
            <Notice kind="info">這個檔案沒有 Store 欄，請選擇這份資料屬於哪個分店。（有 Store 欄的檔案會依每一列的分店匯入，不用選。）</Notice>
            <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} />
          </>
        )}
        <Notice kind="info">
          這裡直接寫入資料庫（不像分店現金頁面要再按「儲存」、SF頁面要再按「提交」）。
          {kind === 'sf'
            ? '每個分店會讀檔案裡同名的那個工作表（SF範本每個分店各自一個分頁），檔案裡有幾個月份的資料就會匯入幾個月份，一次套用全部分店。'
            : '每一列的分店以檔案裡的 Store 欄為準（分店名稱要跟系統裡的一樣），檔案裡有幾個月份的資料就會匯入幾個月份，不需要先選分店或月份。'}
        </Notice>

        {state.loading && <LoadingSpinner label="讀取檔案…" />}
        {state.failed && <Notice kind="error">{state.failed}</Notice>}
        {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

        {!state.loading && !state.failed && (
          <>
            <div className="text-gray-500">
              檔案：{file.name}
              {kind === 'cashday' && state.sheetName ? `（工作表：${state.sheetName}）` : ''}
            </div>

            {state.unknown?.length > 0 && (
              <Notice kind="error">
                有些列的分店在系統裡找不到，這些列沒有被匯入：{state.unknown.map((u) => `「${u.name}」${u.count} 列`).join('、')}。請確認 Store 欄的分店名稱。
              </Notice>
            )}
            {state.notFound?.length > 0 && (
              <Notice kind="info">檔案裡沒有找到「{state.notFound.join('、')}」的分頁，這些分店沒有被匯入。</Notice>
            )}
            {state.broken?.length > 0 && (
              <Notice kind="error">
                {state.broken.map((b) => `「${b.name}」：${b.error}`).join('；')}
              </Notice>
            )}

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
                        {jobs.map((j) => {
                          const toApply = overwrite ? j.result.entries : j.kept.entries
                          return (
                            <tr key={j.key} className="border-t border-gray-100">
                              <td className="px-3 py-2">{j.storeName}</td>
                              <td className="px-3 py-2">{kind === 'sf' ? monthLabel(j.year, j.month) : j.monthText}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{Object.keys(toApply).length} 天</td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                                {overwrite ? '—' : `${j.kept.skipped} 格`}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                {totalDayCount === 0 && <Notice kind="error">這個檔案裡沒有可匯入的資料。</Notice>}
                {totalUnreadable > 0 && <Notice kind="info">有 {totalUnreadable} 列的日期看不懂，已略過。</Notice>}
                {totalBadCells > 0 && <Notice kind="info">有 {totalBadCells} 格不是數字，已略過。</Notice>}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
