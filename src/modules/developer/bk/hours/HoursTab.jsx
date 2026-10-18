import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { brisbaneToday, fmtMoney, isWeekend, monthDates, weekdayOf } from '../bkUtils'
import { loadHourSalesMonth, loadHourSettings } from '../bkHourData'
import { gridStats, hourLabel, hourlyByDay, hoursFor, settingsMap } from '../bkHourly'
import { Notice, StoreTabs, YearMonthPicker } from '../bkUi'
import HourBreakdown from './HourBreakdown'
import HourImport from './HourImport'

const th = 'border border-white/70 bg-brand-100 px-1 py-1.5 text-[11px] font-semibold leading-tight text-gray-700'
const td = 'border border-gray-100 p-0'
const HOUR_W = 66
const money = (v) => (v === null || v === undefined ? '' : fmtMoney(v))

// 小時統計: every day of a month × every hour (the hours set for the store in
// 系統設置 › 小時統計), 營業額 = POS + 自動點單. Stores are the SF / U帳 list.
export default function HoursTab({ stores, topActive = true }) {
  const today = brisbaneToday()
  const [storeId, setStoreId] = useState(null) // null = 全部分店
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)
  const [settings, setSettings] = useState({})
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [dayView, setDayView] = useState(null)

  const scopeIds = useMemo(() => (storeId ? [storeId] : stores.map((s) => s.id)), [storeId, stores])
  const storeKey = stores.map((s) => s.id).join(',')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [set, data] = await Promise.all([loadHourSettings(), loadHourSalesMonth(stores.map((s) => s.id), year, month)])
      setSettings(settingsMap(set))
      setRows(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [storeKey, year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (topActive) load() // also re-reads the hour settings after they were changed in 系統設置
  }, [topActive, load])

  const dates = useMemo(() => monthDates(year, month), [year, month])
  const hours = useMemo(() => hoursFor(settings, scopeIds), [settings, scopeIds])
  const byDay = useMemo(() => hourlyByDay(rows, scopeIds), [rows, scopeIds])
  const stats = useMemo(() => gridStats(byDay, dates, hours), [byDay, dates, hours])
  const max = useMemo(() => Math.max(0, ...dates.flatMap((d) => hours.map((h) => byDay[d]?.[h] ?? 0))), [dates, hours, byDay])

  // The day's hour distribution as a chart (to copy / download and send on).
  function openDay(date) {
    const row = byDay[date]
    if (!row) return
    const shown = new Set([...hours, ...Object.keys(row).map(Number)])
    const name = storeId ? stores.find((s) => s.id === storeId)?.name : '全部分店'
    setDayView({
      title: `${name} · ${date} ${weekdayOf(date)}`,
      note: '每小時營業額（POS + 自動點單）',
      values: row,
      days: 1,
      hours: [...shown].sort((a, b) => a - b),
    })
  }

  if (stores.length === 0) {
    return <Notice kind="info">還沒有任何分店。請先到 系統設置 › SF › 分店管理 新增分店。</Notice>
  }

  const cols = hours.length + 1 + (stats.outsideAny ? 1 : 0)
  const topRow = (label, src, grand, hint) => (
    <tr>
      <td className="sticky left-0 z-30 border border-gray-100 bg-brand-50 px-1.5 py-1.5 text-[13px] font-semibold" title={hint}>
        {label}
      </td>
      {hours.map((h) => (
        <td key={h} className={`${td} bg-brand-50`}>
          <div className="px-1 py-1 text-right text-[12px] font-semibold tabular-nums">{money(src[h])}</div>
        </td>
      ))}
      <td className={`${td} border-l-2 border-l-brand-300 bg-brand-50`}>
        <div className="px-1 py-1 text-right text-[12px] font-semibold tabular-nums">{money(grand)}</div>
      </td>
      {stats.outsideAny && <td className={`${td} bg-brand-50`} />}
    </tr>
  )

  return (
    <div className="space-y-3">
      <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} allowAll />
      <div className="flex flex-wrap items-center gap-3">
        <YearMonthPicker year={year} month={month} onChange={(v) => (setYear(v.year), setMonth(v.month))} />
        <span className="text-xs text-gray-400">營業額 = POS + 自動點單；顯示的時段在 系統設置 › 小時統計 設定。點日期可看當天的小時分佈圖（可複製圖片／表格）</span>
        <div className="ml-auto">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            匯入
          </Button>
        </div>
      </div>
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="max-h-[75vh] overflow-auto rounded-xl border border-brand-100">
          <table className="w-full table-fixed border-collapse text-[13px]" style={{ minWidth: 90 + cols * HOUR_W }}>
            <colgroup>
              <col style={{ width: 84 }} />
              {Array.from({ length: cols }, (_, i) => (
                <col key={i} style={{ width: HOUR_W }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <th className={`${th} sticky left-0 z-30 text-left`}>日期</th>
                {hours.map((h) => (
                  <th key={h} className={th}>
                    {hourLabel(h)}
                  </th>
                ))}
                <th className={`${th} border-l-2 border-l-brand-300`}>合計</th>
                {stats.outsideAny && (
                  <th className={th} title="不在設定時段內的營業額（已算在合計裡）">
                    其他時段
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => {
                const weekendBg = isWeekend(date) ? 'bg-gray-50' : 'bg-white'
                const has = !!byDay[date]
                return (
                  <tr key={date} className={weekendBg}>
                    <td className={`${td} sticky left-0 z-10 whitespace-nowrap ${weekendBg}`}>
                      <button
                        type="button"
                        disabled={!has}
                        onClick={() => openDay(date)}
                        className="flex w-full items-center gap-1 px-1.5 py-1 text-left enabled:hover:bg-brand-50 enabled:hover:underline"
                        title={has ? '點擊查看這天的小時分佈圖（可複製圖片／表格）' : undefined}
                      >
                        <span className="font-medium">{Number(date.slice(8))}</span>
                        <span className="text-[11px] text-gray-400">{weekdayOf(date)}</span>
                                      </button>
                    </td>
                    {hours.map((h) => {
                      const v = byDay[date]?.[h]
                      return (
                        <td key={h} className={td} style={v ? { backgroundColor: `rgba(251,146,60,${0.06 + 0.4 * (v / (max || 1))})` } : undefined}>
                          <div className="px-1 py-1 text-right text-[12px] tabular-nums text-gray-700">{has ? money(v ?? 0) : ''}</div>
                        </td>
                      )
                    })}
                    <td className={`${td} border-l-2 border-l-brand-300`}>
                      <div className="px-1 py-1 text-right text-[12px] font-medium tabular-nums text-gray-800">{money(stats.dayTotal[date])}</div>
                    </td>
                    {stats.outsideAny && (
                      <td className={td}>
                        <div className="px-1 py-1 text-right text-[12px] tabular-nums text-gray-500">{stats.dayOutside[date] ? money(stats.dayOutside[date]) : ''}</div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              {topRow('Total', stats.total, stats.grand)}
              {topRow('平均', stats.average, stats.avgDay, '每個小時的平均（只算有資料的日子）；合計欄是每日平均')}
            </tfoot>
          </table>
        </div>
      )}

      <HourBreakdown view={dayView} onClose={() => setDayView(null)} />

      {importing && (
        <HourImport
          stores={stores}
          defaultStoreId={storeId}
          onClose={() => setImporting(false)}
          onImported={(n) => {
            setImporting(false)
            setMsg(`已匯入 ${n} 筆。`)
            load()
          }}
        />
      )}
    </div>
  )
}
