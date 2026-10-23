import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Badge from '../../../../components/ui/Badge'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { fmtMoney, isWeekend, monthDates, round2, toNum, weekdayOf } from '../bkUtils'
import { loadSalesRange, saveSalesFields } from '../bkSalesData'
import { BIZ_INPUTS, bizDaysFromRows } from '../bkSalesUtils'
import { MoneyInput, Notice, YearMonthPicker } from '../bkUi'

// The fields typed here (everything but POS); each store page shows them read-only.
// A store linked to SF reads its POS from SF's O.POST, so POS is not typed here; a store
// that is NOT linked (no SF) gets a POS column right after P杯數.
const NO_POS_INPUTS = BIZ_INPUTS.filter((i) => i.key !== 'pos')
const inputsFor = (store) => (store.sf_store_id ? NO_POS_INPUTS : BIZ_INPUTS)
const fieldsFor = (store) => inputsFor(store).map((i) => i.field)
const ALL_FIELDS = BIZ_INPUTS.map((i) => i.field)

const fmtCount = (n) => (n === null || n === undefined ? '' : round2(n).toLocaleString('en-AU', { maximumFractionDigits: 2 }))
const th = 'border border-brand-100 px-1 py-1.5 text-[11px] font-semibold leading-tight text-gray-700'
const td = 'border border-gray-100 p-0'
const split = 'border-l-2 border-l-brand-300'
// Counts (P杯數, CV, SO杯數) are narrow, the money column (Self O) a bit wider, so five stores fit on one screen.
const COUNT_W = 54
const MONEY_W = 78
const DATE_W = 64
const colWidth = (money) => (money ? MONEY_W : COUNT_W)
const BLOCK_BG = ['bg-sky-50', 'bg-amber-50']
const BLOCK_CELL_BG = ['bg-sky-50/40', 'bg-amber-50/40']

// 手動輸入總頁: P杯數 / CV / Self O / SO杯數 of every store in one sheet (one
// block per store), so figures of several stores can be typed without switching
// tabs. Same data as the store pages: they read these four columns from here.
export default function BizOverview({ stores, year, month, onYearMonth, onDirtyChange, onSaveReady }) {
  const [data, setData] = useState({}) // { [storeId]: { [date]: day } }
  const [touched, setTouched] = useState({}) // { 'storeId|date': true }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const dirty = Object.keys(touched).length > 0

  const dates = useMemo(() => monthDates(year, month), [year, month])
  const storeKey = stores.map((s) => s.id).join(',')

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving this view (or discarding) must not leave the parent thinking it is still dirty.
  useEffect(() => () => onDirtyChange?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setMsg('')
    try {
      const rows = await loadSalesRange(stores.map((s) => s.id), dates[0], dates[dates.length - 1])
      const next = {}
      for (const s of stores) next[s.id] = bizDaysFromRows(rows.filter((r) => r.store_id === s.id))
      setData(next)
      setTouched({})
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [storeKey, dates]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  function setField(storeId, date, field, value) {
    setData((prev) => ({ ...prev, [storeId]: { ...(prev[storeId] ?? {}), [date]: { ...(prev[storeId]?.[date] ?? {}), [field]: value } } }))
    setTouched((prev) => ({ ...prev, [`${storeId}|${date}`]: true }))
    setMsg('')
  }

  async function save() {
    setSaving(true)
    setError('')
    setMsg('')
    try {
      const byStore = {}
      for (const key of Object.keys(touched)) {
        const [storeId, date] = key.split('|')
        ;(byStore[storeId] ??= {})[date] = data[storeId]?.[date] ?? {}
      }
      for (const [storeId, days] of Object.entries(byStore)) await saveSalesFields(storeId, days, fieldsFor(stores.find((s) => s.id === storeId)))
      setTouched({})
      setMsg('已儲存。')
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  // Hand the parent this page's save (→ true / false) for BK's 儲存 button.
  const saveRef = useRef(null)
  saveRef.current = save
  useEffect(() => {
    onSaveReady?.(() => saveRef.current())
    return () => onSaveReady?.(null)
  }, [onSaveReady])

  const totals = useMemo(() => {
    const out = {}
    for (const s of stores) {
      out[s.id] = {}
      for (const f of ALL_FIELDS) {
        let sum = 0
        let any = false
        for (const d of dates) {
          const n = toNum(data[s.id]?.[d]?.[f])
          if (n !== null) {
            sum += n
            any = true
          }
        }
        out[s.id][f] = any ? round2(sum) : null
      }
    }
    return out
  }, [data, stores, dates])

  // Enter moves to the same column on the next day, like a spreadsheet.
  function onKeyDown(e, rowIdx, key) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = e.currentTarget.closest('table')?.querySelector(`[data-ov="${rowIdx + 1}:${key}"]`)
    if (next) {
      next.focus()
      next.select?.()
    }
  }

  if (stores.length === 0) return <Notice kind="info">還沒有任何鷹眼分店。請先到 系統設置 › 鷹眼 › 分店管理 新增分店。</Notice>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-brand-900">手動輸入總頁</span>
        <YearMonthPicker year={year} month={month} onChange={onYearMonth} />
        {dirty && <Badge color="brand">有未儲存的變更</Badge>}
        <div className="ml-auto">
          <Button onClick={save} disabled={saving || loading || !dirty}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </div>
      <Notice kind="info">
        各分店的 P杯數、CV、Self O、SO杯數都在這裡輸入，分店頁面會直接讀這裡的數字（分店頁只能看，不能改）。有連結消費展望的分店，POS 讀消費展望的 O.POST；沒有連結消費展望的分店，POS 欄也在這裡輸入（P杯數右邊）。
      </Notice>
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-brand-100">
          <table className="table-fixed border-collapse text-[13px]" style={{ width: DATE_W + stores.reduce((sum, s) => sum + inputsFor(s).reduce((a, i) => a + colWidth(i.money), 0), 0) }}>
            <colgroup>
              <col style={{ width: DATE_W }} />
              {stores.flatMap((s) => inputsFor(s).map(({ key, money }) => <col key={`${s.id}${key}`} style={{ width: colWidth(money) }} />))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <th rowSpan={2} className={`${th} sticky left-0 z-30 bg-brand-100 text-left`}>日期</th>
                {stores.map((s, si) => (
                  <th key={s.id} colSpan={inputsFor(s).length} className={`${th} ${BLOCK_BG[si % 2]} text-center text-[13px] text-brand-900 ${split}`}>
                    {s.name}
                  </th>
                ))}
              </tr>
              <tr>
                {stores.flatMap((s, si) =>
                  inputsFor(s).map(({ key, label }, i) => (
                    <th key={`${s.id}${key}`} className={`${th} ${BLOCK_BG[si % 2]} ${i === 0 ? split : ''}`}>
                      {label}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, ri) => {
                const weekendBg = isWeekend(date) ? 'bg-gray-50' : 'bg-white'
                return (
                  <tr key={date} className={weekendBg}>
                    <td className={`${td} sticky left-0 z-10 whitespace-nowrap px-1.5 py-1 ${weekendBg}`}>
                      <span className="font-medium">{Number(date.slice(8))}</span> <span className="text-[11px] text-gray-400">{weekdayOf(date)}</span>
                    </td>
                    {stores.flatMap((s, si) =>
                      inputsFor(s).map(({ key, field, money }, i) => {
                        const day = data[s.id]?.[date] ?? {}
                        return (
                          <td key={`${s.id}${key}`} className={`${td} ${BLOCK_CELL_BG[si % 2]} ${i === 0 ? split : ''}`}>
                            <MoneyInput
                              value={day[field]}
                              onChange={(v) => setField(s.id, date, field, v)}
                              allowNegative={false}
                              plain={!money}
                              className="!px-1 !text-[13px]"
                              onBlur={
                                money
                                  ? () => {
                                      const n = Number(day[field])
                                      if (day[field] !== '' && day[field] !== undefined && Number.isFinite(n)) {
                                        const fixed = (Math.round(n * 100) / 100).toFixed(2)
                                        if (fixed !== day[field]) setField(s.id, date, field, fixed)
                                      }
                                    }
                                  : undefined
                              }
                              data-ov={`${ri}:${s.id}${key}`}
                              onKeyDown={(e) => onKeyDown(e, ri, `${s.id}${key}`)}
                            />
                          </td>
                        )
                      })
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-brand-50 font-semibold">
                <td className={`${td} sticky left-0 z-30 bg-brand-50 px-1.5 py-1.5`}>Total</td>
                {stores.flatMap((s) =>
                  inputsFor(s).map(({ key, field, money }, i) => (
                    <td key={`${s.id}${key}`} className={`${td} ${i === 0 ? split : ''}`}>
                      <div className="px-1 py-1 text-right tabular-nums">{money ? fmtMoney(totals[s.id][field]) : fmtCount(totals[s.id][field])}</div>
                    </td>
                  ))
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
