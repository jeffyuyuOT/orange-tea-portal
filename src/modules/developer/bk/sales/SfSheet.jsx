import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import Badge from '../../../../components/ui/Badge'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import {
  buildColumns,
  computeSfDay,
  computeSfTotals,
  dMapFromRows,
  fmtMoney,
  inactiveIdsWithData,
  isWeekend,
  monthDates,
  numToInput,
  prevMonth,
  sfDaysFromRows,
  sfSubmitProblems,
  weekdayOf,
} from '../bkUtils'
import { loadCashDays, loadPaymentTypes, loadSfMonth, saveSfMonth } from '../bkData'
import { exportSfXlsx } from '../bkExcel'
import { MoneyInput, Notice, StoreTabs, YearMonthPicker } from '../bkUi'
import ImportByImage from './ImportByImage'
import SfExcelImport from './SfExcelImport'

const emptyDay = () => ({ o_ca: '', total: '', amounts: {} })

// The SF sub-tab: store tabs, year/month, Save / Submit / Action, and the
// month table (Date | main payment types | Total | Sum vs Total | sub payment
// types | O.CA). Cash is never typed — it is O.CA − D, D coming from U帳.
export default function SfSheet({ stores, store, year, month, typesVersion, active, onNavigate, onDirtyChange }) {
  const [types, setTypes] = useState([])
  const [sfMonth, setSfMonth] = useState(null)
  const [days, setDays] = useState({})
  const [dMap, setDMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [problems, setProblems] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Columns of this store (re-read after 資料維護 changes them).
  useEffect(() => {
    let cancelled = false
    loadPaymentTypes(store.id)
      .then((rows) => !cancelled && setTypes(rows))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [store.id, typesVersion])

  // The month's saved data. Changing store / month replaces whatever is on
  // screen (the parent already asked about unsaved changes before navigating).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setMsg('')
      try {
        const [sf, cash] = await Promise.all([loadSfMonth(store.id, year, month), loadCashDays(store.id, year, month)])
        if (cancelled) return
        setSfMonth(sf.sfMonth)
        setDays(sfDaysFromRows(sf.days))
        setDMap(dMapFromRows(cash))
        setDirty(false)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store.id, year, month])

  // D can change in U帳 while this tab is hidden — re-read it when coming back.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadCashDays(store.id, year, month)
      .then((rows) => !cancelled && setDMap(dMapFromRows(rows)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, store.id, year, month])

  const dates = useMemo(() => monthDates(year, month), [year, month])
  const columns = useMemo(() => buildColumns(types, inactiveIdsWithData(types, days)), [types, days])
  const subs = useMemo(() => columns.flatMap((c) => c.subs.map((s) => ({ ...s, parentName: c.name }))), [columns])
  const rows = useMemo(
    () => dates.map((date) => computeSfDay(columns, days[date] ?? emptyDay(), dMap[date] ?? null)),
    [dates, columns, days, dMap]
  )
  const totals = useMemo(() => computeSfTotals(columns, rows), [columns, rows])

  function setField(date, field, value) {
    setDays((prev) => ({ ...prev, [date]: { ...(prev[date] ?? emptyDay()), [field]: value } }))
    setDirty(true)
    setMsg('')
  }
  function setAmount(date, typeId, value) {
    setDays((prev) => {
      const cur = prev[date] ?? emptyDay()
      return { ...prev, [date]: { ...cur, amounts: { ...cur.amounts, [typeId]: value } } }
    })
    setDirty(true)
    setMsg('')
  }

  async function persist(submit) {
    setSaving(true)
    setError('')
    setMsg('')
    try {
      const saved = await saveSfMonth({ storeId: store.id, year, month, existing: sfMonth, days, submit })
      setSfMonth(saved)
      setDirty(false)
      setMsg(submit ? '已提交。' : '已儲存（狀態：未提交）。')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    const found = sfSubmitProblems(dates, days)
    if (found.length > 0) {
      setProblems(found)
      return
    }
    await persist(true)
  }

  async function doExport() {
    setMenuOpen(false)
    try {
      await exportSfXlsx({ storeName: store.name, year, month, columns, days, dMap })
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    }
  }

  // 匯入 Excel: the picked file is previewed in SfExcelImport; 套用 fills the
  // sheet (never saves). Only the cells the file actually has are touched.
  function applyImport(entries) {
    setDays((prev) => {
      const next = { ...prev }
      for (const [date, entry] of Object.entries(entries)) {
        const cur = next[date] ?? emptyDay()
        const amounts = { ...cur.amounts }
        for (const [id, v] of Object.entries(entry.amounts)) amounts[id] = numToInput(v)
        next[date] = {
          ...cur,
          o_ca: entry.o_ca !== undefined ? numToInput(entry.o_ca) : cur.o_ca,
          total: entry.total !== undefined ? numToInput(entry.total) : cur.total,
          amounts,
        }
      }
      return next
    })
    setDirty(true)
    setImportFile(null)
    setError('')
    setMsg(`已把 ${Object.keys(entries).length} 天的 Excel 資料填進表格，請檢查後按「儲存」。`)
  }

  function loadPrevious() {
    setMenuOpen(false)
    const p = prevMonth(year, month)
    onNavigate({ year: p.year, month: p.month })
  }

  // Enter moves to the same column on the next day, like a spreadsheet.
  function onKeyDown(e, rowIdx, colKey) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = e.currentTarget.closest('table')?.querySelector(`[data-sf="${rowIdx + 1}:${colKey}"]`)
    if (next) {
      next.focus()
      next.select?.()
    }
  }

  const status = dirty
    ? { color: 'brand', text: '有未儲存的變更' }
    : !sfMonth
      ? { color: 'gray', text: '尚未儲存' }
      : sfMonth.status === 'submitted'
        ? { color: 'green', text: '已提交' }
        : { color: 'red', text: '未提交' }
  const canExport = sfMonth?.status === 'submitted' && !dirty

  const th = 'border border-brand-100 px-2 py-1.5 text-xs font-semibold text-gray-700'
  const td = 'border border-gray-100 p-0'
  const inputFor = (i, colKey, value, onChange) => (
    <MoneyInput value={value} onChange={onChange} data-sf={`${i}:${colKey}`} onKeyDown={(e) => onKeyDown(e, i, colKey)} />
  )

  return (
    <div className="space-y-3">
      <StoreTabs stores={stores} storeId={store.id} onChange={(id) => onNavigate({ storeId: id })} />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-brand-900">{store.name}</span>
        <YearMonthPicker year={year} month={month} onChange={(v) => onNavigate(v)} />
        <Badge color={status.color}>{status.text}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => persist(false)} disabled={saving || loading}>
            儲存
          </Button>
          <Button onClick={submit} disabled={saving || loading}>
            提交
          </Button>
          <div className="relative">
            <Button variant="secondary" onClick={() => setMenuOpen((v) => !v)}>
              Action ▾
            </Button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-brand-100 bg-white shadow-lg">
                <button
                  type="button"
                  disabled={!canExport}
                  onClick={doExport}
                  title={canExport ? '' : '只有已提交且沒有未儲存變更的 SF 才能匯出'}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                >
                  匯出 Excel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    fileInputRef.current?.click()
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                >
                  匯入 Excel
                </button>
                <button type="button" onClick={loadPrevious} className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50">
                  載入上個月 SF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        data-testid="sf-excel-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = '' // picking the same file again should still fire
          if (f) setImportFile(f)
        }}
      />
      {importFile && (
        <SfExcelImport
          file={importFile}
          columns={columns}
          year={year}
          month={month}
          days={days}
          onApply={applyImport}
          onClose={() => setImportFile(null)}
        />
      )}

      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}
      {sfMonth?.status === 'submitted' && dirty && (
        <Notice kind="info">這個月已提交；按「儲存」後狀態會變回「未提交」，需要重新提交。</Notice>
      )}

      <ImportByImage />

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-brand-100">
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className={`${th} sticky left-0 z-30 min-w-24 bg-brand-100 text-left`}>日期</th>
                {columns.map((c) => (
                  <th key={c.id} className={`${th} min-w-28 bg-brand-100`}>
                    {c.name}
                    {!c.is_active && <div className="text-[10px] font-normal text-gray-400">(已停用)</div>}
                    {c.subs.length > 0 && <div className="text-[10px] font-normal text-gray-500">= sub 加總</div>}
                    {c.is_locked && c.name === 'Cash' && <div className="text-[10px] font-normal text-gray-500">= O.CA − D</div>}
                  </th>
                ))}
                <th className={`${th} min-w-28 bg-brand-200`}>Total</th>
                <th className={`${th} min-w-24 bg-gray-100`}>Sum vs Total</th>
                {subs.map((s) => (
                  <th key={s.id} className={`${th} min-w-28 bg-sky-50`}>
                    {s.name}
                    <div className="text-[10px] font-normal text-gray-500">{s.parentName}</div>
                  </th>
                ))}
                <th className={`${th} min-w-28 bg-green-50`}>O.CA</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => {
                const r = rows[i]
                const day = days[date] ?? emptyDay()
                const weekendBg = isWeekend(date) ? 'bg-gray-50' : 'bg-white'
                return (
                  <tr key={date} className={weekendBg}>
                    <td className={`${td} sticky left-0 z-10 whitespace-nowrap px-2 py-1 ${weekendBg}`}>
                      <span className="font-medium">{Number(date.slice(8))}</span>{' '}
                      <span className="text-xs text-gray-400">{weekdayOf(date)}</span>
                    </td>
                    {columns.map((c) => {
                      const computed = (c.is_locked && c.name === 'Cash') || c.subs.length > 0
                      return (
                        <td key={c.id} className={td}>
                          {computed ? (
                            <div
                              className="px-2 py-1 text-right tabular-nums text-gray-700"
                              title={c.subs.length ? '由 sub payment type 加總' : 'O.CA − D'}
                            >
                              {fmtMoney(r.mains[c.id])}
                            </div>
                          ) : (
                            inputFor(i, c.id, day.amounts[c.id], (v) => setAmount(date, c.id, v))
                          )}
                        </td>
                      )
                    })}
                    <td className={td}>{inputFor(i, 'total', day.total, (v) => setField(date, 'total', v))}</td>
                    <td className={`${td} text-center`}>
                      {r.check === 'ok' && <span className="font-bold text-green-600" title="主 payment 加總 = Total">✓</span>}
                      {r.check === 'bad' && (
                        <span
                          className="font-bold text-red-600"
                          title={`主 payment 加總 ${fmtMoney(r.sum) || '—'} ≠ Total ${fmtMoney(r.total) || '—'}`}
                        >
                          ✗
                        </span>
                      )}
                    </td>
                    {subs.map((s) => (
                      <td key={s.id} className={td}>
                        {inputFor(i, s.id, day.amounts[s.id], (v) => setAmount(date, s.id, v))}
                      </td>
                    ))}
                    <td className={td}>{inputFor(i, 'o_ca', day.o_ca, (v) => setField(date, 'o_ca', v))}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-brand-50 font-semibold">
                <td className={`${td} sticky left-0 z-30 bg-brand-50 px-2 py-1.5`}>Total</td>
                {columns.map((c) => (
                  <td key={c.id} className={`${td} px-2 py-1.5 text-right tabular-nums`}>
                    {fmtMoney(totals.mains[c.id])}
                  </td>
                ))}
                <td className={`${td} px-2 py-1.5 text-right tabular-nums`}>{fmtMoney(totals.total)}</td>
                <td className={td} />
                {subs.map((s) => (
                  <td key={s.id} className={`${td} px-2 py-1.5 text-right tabular-nums`}>
                    {fmtMoney(totals.subs[s.id])}
                  </td>
                ))}
                <td className={`${td} px-2 py-1.5 text-right tabular-nums`}>{fmtMoney(totals.oCa)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal
        open={!!problems}
        onClose={() => setProblems(null)}
        title="無法提交：有日期缺少資料"
        footer={<Button onClick={() => setProblems(null)}>知道了</Button>}
      >
        <p className="mb-2 text-sm text-gray-600">每一天都需要 Cash（O.CA）與 Total 的紀錄才能提交。缺少的日期：</p>
        <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
          {problems?.map((p) => (
            <li key={p.date} className="flex justify-between rounded bg-red-50 px-2 py-1">
              <span>{p.date}</span>
              <span className="text-red-600">缺少 {p.missing.join('、')}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  )
}
