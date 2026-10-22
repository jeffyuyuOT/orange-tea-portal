import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { brisbaneToday, brisbaneTodayStr, fmtMoney, monthDates, round2, weekdayOf } from '../bkUtils'
import { loadPublicHolidays, loadSalesAll, loadSalesNotesAll, loadSfPostAll } from '../bkSalesData'
import { loadHourSalesRange, loadHourSettings } from '../bkHourData'
import { averageByHour, hourlyByDay, hoursFor, settingsMap } from '../bkHourly'
import HourBreakdown from '../hours/HourBreakdown'
import {
  QUARTER_MONTHS,
  aggregateDays,
  buildEvents,
  buildStoreDays,
  dayAcrossYears,
  daysOfMonth,
  eventsLike,
  eventsOfYear,
  eventYears,
  monthAcrossYears,
  monthsOfYear,
  quarterAcrossYears,
  matchesPeriod,
  quartersOfYear,
  recordYears,
  weekdayIndex,
  weekdayAcrossYears,
  weekdayStats,
  withSales,
} from '../bkBizHistory'
import { Notice, StoreTabs, SubTabs, YearMonthPicker, inputCls } from '../bkUi'

const KINDS = [
  ['quarter', '季紀錄'],
  ['month', '月紀錄'],
  ['day', '日記錄'],
  ['event', 'Event'],
  ['week', '週統計'],
]

const money = (n) => (n === null || n === undefined ? '—' : fmtMoney(n))
const count = (n) => (n === null || n === undefined ? '—' : round2(n).toLocaleString('en-AU', { maximumFractionDigits: 2 }))

// Years offered in a picker: the ones that have data, plus this year.
function yearChoices(years) {
  const set = new Set([...years, brisbaneToday().year])
  return [...set].sort((a, b) => b - a)
}

function YearSelect({ years, value, onChange }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Year">
      {yearChoices(years).map((y) => (
        <option key={y} value={y}>
          {y} 年
        </option>
      ))}
    </select>
  )
}

// A clickable block: label + 總營業額 + 總杯數 (+ 日均杯數 when given).
function Tile({ label, sub, total, cups, avgCups, onClick }) {
  const empty = total === null && cups === null
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition hover:border-brand-400 hover:shadow-sm ${empty ? 'border-gray-100 bg-gray-50' : 'border-brand-100 bg-white'}`}
    >
      <div className="text-sm font-semibold text-brand-900">
        {label} {sub && <span className="text-xs font-normal text-gray-400">{sub}</span>}
      </div>
      <div className="mt-2 text-xs text-gray-500">總營業額</div>
      <div className="text-lg font-semibold tabular-nums text-gray-900">{money(total)}</div>
      <div className="mt-1 text-xs text-gray-500">總杯數</div>
      <div className="text-lg font-semibold tabular-nums text-gray-900">{count(cups)}</div>
      {avgCups !== undefined && (
        <>
          <div className="mt-1 text-xs text-gray-500">日均杯數</div>
          <div className="text-lg font-semibold tabular-nums text-gray-900">{count(avgCups)}</div>
        </>
      )}
    </button>
  )
}

const th = 'border-b border-brand-100 bg-brand-50 px-3 py-2 text-left text-xs font-semibold text-gray-600'
const td = 'border-b border-gray-100 px-3 py-2 text-sm'

// The popup of a clicked block: the same period in every year.
function DetailModal({ detail, onClose, onHours }) {
  return (
    <Modal open={!!detail} onClose={onClose} title={detail?.title ?? ''} footer={<Button onClick={onClose}>關閉</Button>}>
      {detail && (
        <div className="overflow-hidden rounded-lg border border-brand-100">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{detail.firstCol}</th>
                <th className={`${th} text-right`}>總營業額</th>
                <th className={`${th} text-right`}>總杯數</th>
                {detail.rows.some((r) => 'avgCups' in r) && <th className={`${th} text-right`}>日均杯數</th>}
                {detail.rows.some((r) => r.hour) && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {detail.rows.length === 0 && (
                <tr>
                  <td className={`${td} text-gray-400`} colSpan={5}>
                    沒有紀錄
                  </td>
                </tr>
              )}
              {detail.rows.map((r) => (
                <tr key={r.key} className={r.highlight ? 'bg-brand-50/60 font-medium' : ''}>
                  <td className={td}>{r.label}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(r.total)}</td>
                  <td className={`${td} text-right tabular-nums`}>{count(r.cups)}</td>
                  {detail.rows.some((x) => 'avgCups' in x) && <td className={`${td} text-right tabular-nums`}>{count(r.avgCups)}</td>}
                  {detail.rows.some((x) => x.hour) && (
                    <td className={`${td} text-right`}>
                      {r.hour && (
                        <button
                          type="button"
                          onClick={() => onHours(r.hour, `${detail.title} · ${r.label}`)}
                          className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                        >
                          小時統計
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

// 歷史紀錄 › 營業. 總營業額 and 總杯數 (季／月 also 日均杯數); every block opens the same period in
// earlier (and later) years.
export default function HistoryBiz({ salesStores, stores = [], active }) {
  const today = brisbaneToday()
  const [storeId, setStoreId] = useState(null) // null = 全部分店
  const [kind, setKind] = useState('quarter')
  const [data, setData] = useState(null) // { sales, posts, notes, holidays }
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [year, setYear] = useState(today.year)
  const [dayYM, setDayYM] = useState({ year: today.year, month: today.month })
  const [wQuarter, setWQuarter] = useState('')
  const [wMonth, setWMonth] = useState('')
  const [hourView, setHourView] = useState(null)

  const storeKey = salesStores.map((s) => `${s.id}:${s.sf_store_id ?? ''}`).join(',')
  const reload = useCallback(async () => {
    try {
      const ids = salesStores.map((s) => s.id)
      const sfIds = salesStores.map((s) => s.sf_store_id).filter(Boolean)
      const [sales, posts, notes, holidays] = await Promise.all([
        loadSalesAll(ids),
        loadSfPostAll(sfIds),
        loadSalesNotesAll(ids),
        loadPublicHolidays().catch(() => ({})), // the payroll list is a bonus; never block the page on it
      ])
      setData({ sales, posts, notes, holidays })
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [storeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active) reload()
  }, [active, reload])

  const storeDays = useMemo(() => (data ? buildStoreDays(salesStores, data.sales, data.posts) : {}), [data, salesStores])
  const scopeIds = useMemo(() => (storeId ? [storeId] : salesStores.map((s) => s.id)), [storeId, salesStores])
  const records = useMemo(() => aggregateDays(storeDays, scopeIds), [storeDays, scopeIds])
  const years = useMemo(() => recordYears(records), [records])
  const events = useMemo(
    // Jeff, 2026-10-17: dates that haven't happened yet (e.g. next year's holidays from the payroll list) have no figures — left out.
    () => (data ? withSales(buildEvents(data.notes, data.holidays, scopeIds), records).filter((e) => e.date <= brisbaneTodayStr()) : []),
    [data, scopeIds, records]
  )

  if (salesStores.length === 0) {
    return <Notice kind="info">還沒有任何營業分店。請先到 系統設置 › 營業 › 分店管理 新增分店。</Notice>
  }

  const wFilter = { quarter: wQuarter ? Number(wQuarter) : null, month: wMonth ? Number(wMonth) : null }

  function showAcross(title, firstCol, rows) {
    setDetail({ title, firstCol, rows })
  }

  // 小時統計 button of a detail row. spec = { type:'day', date } | { type:'weekday', index, year, filter }.
  async function openHours(spec, title) {
    const ids = scopeIds
    setHourView({ title, loading: true })
    try {
      const from = spec.type === 'day' ? spec.date : `${spec.year}-01-01`
      const to = spec.type === 'day' ? spec.date : `${spec.year}-12-31`
      const [rows, setRows] = await Promise.all([loadHourSalesRange(ids, from, to), loadHourSettings()])
      const byDay = hourlyByDay(rows, ids)
      const days =
        spec.type === 'day'
          ? [spec.date]
          : Object.keys(byDay).filter((d) => weekdayIndex(d) === spec.index && matchesPeriod(d, { ...spec.filter, year: spec.year }))
      const { values, days: n } = averageByHour(byDay, days)
      const shown = new Set([...hoursFor(settingsMap(setRows), ids), ...Object.keys(values).map(Number)])
      setHourView({
        title,
        values,
        days: n,
        hours: [...shown].sort((a, b) => a - b),
        note: spec.type === 'day' ? '營業額 = POS + 自動點單' : `平均（${n} 天）· 營業額 = POS + 自動點單`,
      })
    } catch (e) {
      setHourView({ title, message: e.message })
    }
  }

  let body = null
  if (!data) body = <LoadingSpinner />
  else if (kind === 'quarter') {
    body = (
      <>
        <div className="flex items-center gap-2">
          <YearSelect years={years} value={year} onChange={setYear} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {quartersOfYear(records, year).map((q) => (
            <Tile
              key={q.key}
              label={`${year} ${q.label}`}
              sub={`${QUARTER_MONTHS[q.key][0]}–${QUARTER_MONTHS[q.key][2]} 月`}
              total={q.total}
              cups={q.cups}
              avgCups={q.avgCups}
              onClick={() =>
                showAcross(
                  `歷年 ${q.label}`,
                  '年份',
                  quarterAcrossYears(records, q.key).map((r) => ({ key: r.year, label: `${r.year} 年`, total: r.total, cups: r.cups, avgCups: r.avgCups, highlight: r.year === year }))
                )
              }
            />
          ))}
        </div>
      </>
    )
  } else if (kind === 'month') {
    body = (
      <>
        <div className="flex items-center gap-2">
          <YearSelect years={years} value={year} onChange={setYear} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {monthsOfYear(records, year).map((m) => (
            <Tile
              key={m.key}
              label={`${year} 年 ${m.label}`}
              total={m.total}
              cups={m.cups}
              avgCups={m.avgCups}
              onClick={() =>
                showAcross(
                  `歷年 ${m.label}`,
                  '年份',
                  monthAcrossYears(records, m.key).map((r) => ({ key: r.year, label: `${r.year} 年`, total: r.total, cups: r.cups, avgCups: r.avgCups, highlight: r.year === year }))
                )
              }
            />
          ))}
        </div>
      </>
    )
  } else if (kind === 'day') {
    const byDate = Object.fromEntries(daysOfMonth(records, dayYM.year, dayYM.month).map((r) => [r.date, r]))
    body = (
      <>
        <YearMonthPicker year={dayYM.year} month={dayYM.month} onChange={setDayYM} />
        <div className="overflow-hidden rounded-xl border border-brand-100">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>日期</th>
                <th className={`${th} text-right`}>總營業額</th>
                <th className={`${th} text-right`}>總杯數</th>
              </tr>
            </thead>
            <tbody>
              {monthDates(dayYM.year, dayYM.month).map((date) => {
                const r = byDate[date]
                return (
                  <tr
                    key={date}
                    className="cursor-pointer hover:bg-brand-50"
                    onClick={() =>
                      showAcross(
                        `歷年 ${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`,
                        '日期',
                        dayAcrossYears(records, date.slice(5)).map((x) => ({
                          key: x.date,
                          label: `${x.date} ${weekdayOf(x.date)}`,
                          total: x.total,
                          cups: x.cups,
                          highlight: x.date === date,
                          hour: { type: 'day', date: x.date },
                        }))
                      )
                    }
                  >
                    <td className={td}>
                      {Number(date.slice(8))} <span className="text-xs text-gray-400">{weekdayOf(date)}</span>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{money(r?.total)}</td>
                    <td className={`${td} text-right tabular-nums`}>{count(r?.cups)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>
    )
  } else if (kind === 'event') {
    const list = eventsOfYear(events, year)
    body = (
      <>
        <div className="flex items-center gap-2">
          <YearSelect years={eventYears(events)} value={year} onChange={setYear} />
        </div>
        <div className="overflow-hidden rounded-xl border border-brand-100">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>日期</th>
                <th className={th}>附註</th>
                <th className={`${th} text-right`}>總營業額</th>
                <th className={`${th} text-right`}>總杯數</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td className={`${td} text-gray-400`} colSpan={4}>
                    {year} 年沒有任何附註或 public holiday
                  </td>
                </tr>
              )}
              {list.map((e) => (
                <tr
                  key={`${e.date}|${e.kind}|${e.label}`}
                  className="cursor-pointer hover:bg-brand-50"
                  onClick={() =>
                    showAcross(
                      e.label,
                      '日期',
                      eventsLike(events, e.label).map((x) => ({
                        key: `${x.date}|${x.kind}`,
                        label: `${x.date} ${weekdayOf(x.date)}`,
                        total: x.total,
                        cups: x.cups,
                        highlight: x.date === e.date,
                        hour: { type: 'day', date: x.date },
                      }))
                    )
                  }
                >
                  <td className={`${td} whitespace-nowrap`}>
                    {e.date.slice(5)} <span className="text-xs text-gray-400">{weekdayOf(e.date)}</span>
                  </td>
                  <td className={td}>
                    <span className={e.kind === 'holiday' ? 'text-rose-700' : 'text-gray-800'}>{e.kind === 'holiday' ? '🎉 ' : '📝 '}</span>
                    {e.label}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{money(e.total)}</td>
                  <td className={`${td} text-right tabular-nums`}>{count(e.cups)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  } else {
    const stats = weekdayStats(records, wFilter)
    const periodLabel = wMonth ? `${wMonth} 月` : wQuarter ? `Q${wQuarter}` : '全年'
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">篩選</span>
          <select className={inputCls} value={wQuarter} onChange={(e) => (setWQuarter(e.target.value), setWMonth(''))} aria-label="Quarter">
            <option value="">全部季</option>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </select>
          <select className={inputCls} value={wMonth} onChange={(e) => (setWMonth(e.target.value), setWQuarter(''))} aria-label="Month">
            <option value="">全部月</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m} 月
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400">每個星期幾的平均（只算有資料的日子）</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((s) => (
            <Tile
              key={s.key}
              label={s.label}
              total={s.total}
              cups={s.cups}
              onClick={() =>
                showAcross(
                  `歷年 ${s.label} 平均（${periodLabel}）`,
                  '年份',
                  weekdayAcrossYears(records, s.key, wFilter).map((r) => ({
                    key: r.year,
                    label: `${r.year} 年`,
                    total: r.total,
                    cups: r.cups,
                    hour: { type: 'weekday', index: s.key, year: r.year, filter: wFilter },
                  }))
                )
              }
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-4">
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      <StoreTabs stores={salesStores} storeId={storeId} onChange={setStoreId} allowAll />
      <SubTabs tabs={KINDS} value={kind} onChange={setKind} />
      {body}
      <DetailModal detail={detail} onClose={() => setDetail(null)} onHours={openHours} />
      <HourBreakdown view={hourView} onClose={() => setHourView(null)} />
    </div>
  )
}
