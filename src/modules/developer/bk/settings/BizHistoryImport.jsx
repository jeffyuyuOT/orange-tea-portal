import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { loadWorkbookSheets } from '../bkImport'
import { loadSalesRange, loadSfPostRange, saveSalesDays } from '../bkSalesData'
import { bizDaysFromRows, postMapFromRows } from '../bkSalesUtils'
import { filterKeepExistingBiz } from '../bkSalesImport'
import { parseBizHistorySheets } from '../bkSalesHistoryImport'
import { Notice } from '../bkUi'

// Names in the old yearly files that mean a store with another name here.
// Jeff, 2026-10-17: "遇到sunnypark店的都當作sunnybank店匯入".
const STORE_ALIASES = { sunnypark: 'sunnybank' }
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s._\-]/g, '')
const canon = (s) => STORE_ALIASES[norm(s)] ?? norm(s)

const CHUNK = 400

// 系統設置 › 匯入 › 營業, for the old yearly workbooks (tabs named 202401 …, every
// store side by side). Writes straight to the database; one file at a time.
export default function BizHistoryImport({ file, salesStores, onImported, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [overwrite, setOverwrite] = useState(false)
  const [applying, setApplying] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sheets = await loadWorkbookSheets(await file.arrayBuffer())
        const parsed = parseBizHistorySheets(sheets)
        const jobs = []
        const unmatched = []
        for (const [fileName, s] of Object.entries(parsed.stores)) {
          const store = salesStores.find((x) => canon(x.name) === canon(fileName))
          const dates = Object.keys(s.entries).sort()
          if (dates.length === 0) continue
          if (!store) {
            unmatched.push(`${fileName}（${dates.length} 天）`)
            continue
          }
          const rows = await loadSalesRange([store.id], dates[0], dates[dates.length - 1])
          // a linked store shows SF's O.POST — so POS from the file is only wanted on days SF has no figure for
          const sfPosts = store.sf_store_id ? postMapFromRows(await loadSfPostRange([store.sf_store_id], dates[0], dates[dates.length - 1])) : {}
          jobs.push({ key: store.id, fileName, store, linked: !!store.sf_store_id, s, dates, days: bizDaysFromRows(rows), sfPosts })
        }
        if (!cancelled) setState({ jobs, unmatched, parsed })
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, salesStores])

  const jobs = useMemo(
    () =>
      (state.jobs ?? []).map((j) => {
        let posDropped = 0 // linked store: SF already has that day's O.POST
        let posKept = 0 // linked store: SF has nothing that day, so the file's POS is imported
        const entries = Object.fromEntries(
          Object.entries(j.s.entries)
            .map(([d, e]) => {
              if (!j.linked || e.pos === undefined) return [d, e]
              if (j.sfPosts[d] !== undefined && j.sfPosts[d] !== null) {
                posDropped++
                return [d, Object.fromEntries(Object.entries(e).filter(([f]) => f !== 'pos'))]
              }
              posKept++
              return [d, e]
            })
            .filter(([, e]) => Object.keys(e).length > 0)
        )
        return { ...j, entries, posDropped, posKept, kept: filterKeepExistingBiz(entries, j.days) }
      }),
    [state.jobs]
  )
  const pick = (j) => (overwrite ? j.entries : j.kept.entries)
  const total = jobs.reduce((n, j) => n + Object.keys(pick(j)).length, 0)
  const parsed = state.parsed

  async function apply() {
    setError('')
    try {
      let count = 0
      for (const j of jobs) {
        const entries = pick(j)
        const dates = Object.keys(entries).sort()
        for (let i = 0; i < dates.length; i += CHUNK) {
          setApplying(`${j.store.name}：${Math.min(i + CHUNK, dates.length)} / ${dates.length}`)
          const part = {}
          for (const d of dates.slice(i, i + CHUNK)) {
            const cur = { ...(j.days[d] ?? {}) }
            for (const [f, v] of Object.entries(entries[d])) cur[f] = String(v)
            part[d] = cur
          }
          if (j.linked) {
            // days that carry a POS (SF has none there) are written with it; the rest as before
            const withPos = {}
            const rest = {}
            for (const d of Object.keys(part)) (entries[d].pos !== undefined ? withPos : rest)[d] = part[d]
            if (Object.keys(withPos).length) await saveSalesDays(j.store.id, withPos, { linked: true, includePos: true })
            if (Object.keys(rest).length) await saveSalesDays(j.store.id, rest, { linked: true })
          } else {
            await saveSalesDays(j.store.id, part, { linked: false })
          }
        }
        count += dates.length
      }
      onImported?.(count)
    } catch (e) {
      setError(e.message)
    } finally {
      setApplying('')
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="匯入 Excel — 營業（歷史年度檔）"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {total > 0 ? '取消' : '關閉'}
          </Button>
          <Button disabled={total === 0 || !!applying} onClick={apply}>
            {applying ? `匯入中… ${applying}` : `套用 ${total} 天`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Notice kind="info">
          這是歷史年度檔（分頁名稱像 202401，每個分頁把各分店並排）。直接寫入資料庫。檔案裡的 Sunnypark 會當作 Sunnybank。總營業額、總杯數由系統計算（POS + Self O + CV×4；P杯數 + SO杯數）。連結SF的分店，POS 以SF的 O.POST 為準，只有SF沒有資料的日期才會匯入檔案裡的 POS。只有「營業額／杯數」合計的舊資料，營業額會記在 POS、杯數記在 P杯數，這樣合計才會一樣。一次匯入一個檔案。
        </Notice>
        {state.loading && <LoadingSpinner label="讀取檔案…" />}
        {state.failed && <Notice kind="error">{state.failed}</Notice>}
        {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
        {!state.loading && !state.failed && (
          <>
            <div className="text-gray-500">檔案：{file.name}</div>
            {state.unmatched?.length > 0 && (
              <Notice kind="info">
                這些分店在營業分店裡找不到同名的，不會匯入：{state.unmatched.join('、')}。需要的話先到 系統設置 › 營業 › 分店管理 新增，再重新匯入這個檔案。
              </Notice>
            )}
            {jobs.length === 0 ? (
              <Notice kind="error">這個檔案裡沒有可以匯入的分店資料。</Notice>
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
                        <th className="px-3 py-2">檔案裡的分店</th>
                        <th className="px-3 py-2">匯入到</th>
                        <th className="px-3 py-2">日期範圍</th>
                        <th className="px-3 py-2 text-right">可匯入</th>
                        <th className="px-3 py-2 text-right">已有資料（跳過）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr key={j.key} className="border-t border-gray-100 align-top">
                          <td className="px-3 py-2">{j.fileName}</td>
                          <td className="px-3 py-2">
                            {j.store.name}
                            {j.linked && (
                              <div className="text-[11px] text-amber-600">
                                連結SF：SF沒有資料的 {j.posKept} 天會匯入 POS；SF已有資料的 {j.posDropped} 天略過 POS
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{j.dates[0]} ~ {j.dates[j.dates.length - 1]}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Object.keys(pick(j)).length} 天</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{overwrite ? '—' : `${j.kept.skipped} 格`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {jobs.some((j) => j.s.legacyDays > 0) && (
                  <Notice kind="info">
                    {jobs.filter((j) => j.s.legacyDays > 0).map((j) => `${j.store.name} ${j.s.legacyDays} 天`).join('、')} 只有營業額／杯數合計，已記在 POS／P杯數。
                  </Notice>
                )}
                {parsed?.mismatch > 0 && <Notice kind="info">有 {parsed.mismatch} 天檔案裡的「營業額」和 POS + Self O + CV×4 對不起來，匯入後以系統計算為準。</Notice>}
                {parsed?.skippedSheets?.length > 0 && <Notice kind="info">略過的分頁：{parsed.skippedSheets.join('、')}</Notice>}
                {parsed?.unreadable > 0 && <Notice kind="info">有 {parsed.unreadable} 列的日期看不懂，已略過。</Notice>}
                {parsed?.badCells > 0 && <Notice kind="info">有 {parsed.badCells} 格不是數字，已略過。</Notice>}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
