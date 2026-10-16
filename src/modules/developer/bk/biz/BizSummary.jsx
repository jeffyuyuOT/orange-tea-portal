import { useEffect, useMemo, useState } from 'react'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { fmtMoney, isWeekend, monthDates, round2, weekdayOf } from '../bkUtils'
import { loadSalesRange, loadSfPostRange } from '../bkSalesData'
import { bizDayRow, bizDaysFromRows, bizTotals, postMapFromRows } from '../bkSalesUtils'
import { Notice, YearMonthPicker } from '../bkUi'

// One colour per store (by position): header, cells and Total / 平均 cells.
const STORE_COLORS = [
  { head: 'bg-sky-200 text-sky-900', top: 'bg-sky-100', cell: 'bg-sky-50/60' },
  { head: 'bg-amber-200 text-amber-900', top: 'bg-amber-100', cell: 'bg-amber-50/60' },
  { head: 'bg-emerald-200 text-emerald-900', top: 'bg-emerald-100', cell: 'bg-emerald-50/60' },
  { head: 'bg-rose-200 text-rose-900', top: 'bg-rose-100', cell: 'bg-rose-50/60' },
  { head: 'bg-violet-200 text-violet-900', top: 'bg-violet-100', cell: 'bg-violet-50/60' },
  { head: 'bg-teal-200 text-teal-900', top: 'bg-teal-100', cell: 'bg-teal-50/60' },
  { head: 'bg-orange-200 text-orange-900', top: 'bg-orange-100', cell: 'bg-orange-50/60' },
  { head: 'bg-indigo-200 text-indigo-900', top: 'bg-indigo-100', cell: 'bg-indigo-50/60' },
]
const storeColor = (i) => STORE_COLORS[i % STORE_COLORS.length]

const fmtCount = (n) => (n === null || n === undefined ? '' : round2(n).toLocaleString('en-AU', { maximumFractionDigits: 2 }))
const fmtAvgCount = (n) =>
  n === null || n === undefined ? '' : round2(n).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const th = 'border border-white/70 px-1 py-1.5 text-[11px] font-semibold leading-tight'
const td = 'border border-gray-100 p-0'
const split = 'border-l-2 border-l-brand-300'

// Per store: the month's daily rows ({ total, cups } per date) plus Total / 平均 —
// the same 總營業額 / 總杯數 as the store's own page (POS + Self O + CV×4,
// P杯數 + SO杯數; a linked store's POS is SF's O.POST).
export function summarizeStores(stores, dates, salesRows, postRows) {
  const out = {}
  for (const s of stores) {
    const days = bizDaysFromRows(salesRows.filter((r) => r.store_id === s.id))
    const postMap = s.sf_store_id ? postMapFromRows(postRows.filter((r) => r.sf_store_id === s.sf_store_id)) : null
    const rows = dates.map((d) => bizDayRow(days[d], postMap ? (postMap[d] ?? null) : undefined))
    const { total, average } = bizTotals(rows)
    out[s.id] = { rows, total, average }
  }
  return out
}

// 總覽: every store's 總營業額 and 總杯數 for each day of the month, one colour
// block per store, with Total and 平均 at the top.
export default function BizSummary({ stores, year, month, onYearMonth, holidays = {} }) {
  const [sales, setSales] = useState([])
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const dates = useMemo(() => monthDates(year, month), [year, month])
  const storeKey = stores.map((s) => `${s.id}:${s.sf_store_id ?? ''}`).join(',')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const from = dates[0]
        const to = dates[dates.length - 1]
        const sfIds = stores.map((s) => s.sf_store_id).filter(Boolean)
        const [a, b] = await Promise.all([loadSalesRange(stores.map((s) => s.id), from, to), loadSfPostRange(sfIds, from, to)])
        if (cancelled) return
        setSales(a)
        setPosts(b)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [storeKey, dates]) // eslint-disable-line react-hooks/exhaustive-deps

  const sums = useMemo(() => summarizeStores(stores, dates, sales, posts), [stores, dates, sales, posts])

  const topRow = (label, key, moneyFmt, countFmt, hint) => (
    <tr>
      <td className={`${td} sticky left-0 z-30 bg-brand-50 px-1.5 py-1.5 text-[13px] font-semibold`} title={hint}>
        {label}
      </td>
      {stores.map((s, i) => {
        const c = storeColor(i)
        const src = sums[s.id]?.[key] ?? {}
        return [
          <td key={`${s.id}t`} className={`${td} ${c.top} ${split}`}>
            <div className="px-1 py-1 text-right font-semibold tabular-nums">{moneyFmt(src.total)}</div>
          </td>,
          <td key={`${s.id}c`} className={`${td} ${c.top}`}>
            <div className="px-1 py-1 text-right font-semibold tabular-nums">{countFmt(src.cups)}</div>
          </td>,
        ]
      })}
    </tr>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-brand-900">總覽</span>
        <YearMonthPicker year={year} month={month} onChange={onYearMonth} />
      </div>
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="max-h-[75vh] overflow-auto rounded-xl border border-brand-100">
          <table className="w-full table-fixed border-collapse text-[13px]" style={{ minWidth: 84 + stores.length * 200 }}>
            <colgroup>
              <col style={{ width: 84 }} />
              {stores.map((s) => [<col key={`${s.id}t`} />, <col key={`${s.id}c`} />])}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <th rowSpan={2} className={`${th} sticky left-0 z-30 bg-brand-100 text-left text-gray-700`}>日期</th>
                {stores.map((s, i) => (
                  <th key={s.id} colSpan={2} className={`${th} ${storeColor(i).head} ${split} text-[13px]`}>
                    {s.name}
                  </th>
                ))}
              </tr>
              <tr>
                {stores.map((s, i) => [
                  <th key={`${s.id}t`} className={`${th} ${storeColor(i).head} ${split}`}>總營業額</th>,
                  <th key={`${s.id}c`} className={`${th} ${storeColor(i).head}`}>總杯數</th>,
                ])}
              </tr>
              {topRow('Total', 'total', fmtMoney, fmtCount)}
              {topRow('平均', 'average', fmtMoney, fmtAvgCount, '用這個月已有資料的天數算每日平均')}
            </thead>
            <tbody>
              {dates.map((date, di) => {
                const holiday = holidays[date]
                const weekendBg = holiday ? 'bg-rose-50' : isWeekend(date) ? 'bg-gray-50' : 'bg-white'
                return (
                  <tr key={date} className={weekendBg}>
                    <td className={`${td} sticky left-0 z-10 whitespace-nowrap px-1.5 py-1 ${weekendBg}`} title={holiday ? `Public holiday：${holiday}` : undefined}>
                      <span className="font-medium">{Number(date.slice(8))}</span>{' '}
                      <span className="text-[11px] text-gray-400">{weekdayOf(date)}</span>
                      {holiday && <span className="ml-1 text-[12px]">🎉</span>}
                    </td>
                    {stores.map((s, i) => {
                      const r = sums[s.id]?.rows[di] ?? {}
                      const c = storeColor(i)
                      return [
                        <td key={`${s.id}t`} className={`${td} ${c.cell} ${split}`}>
                          <div className="px-1 py-1 text-right tabular-nums text-gray-700">{fmtMoney(r.total)}</div>
                        </td>,
                        <td key={`${s.id}c`} className={`${td} ${c.cell}`}>
                          <div className="px-1 py-1 text-right tabular-nums text-gray-700">{fmtCount(r.cups)}</div>
                        </td>,
                      ]
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
