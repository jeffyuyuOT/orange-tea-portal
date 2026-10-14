import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Badge from '../../../../components/ui/Badge'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { brisbaneToday, fmtMoney, isWeekend, monthDates, round2, weekdayOf } from '../bkUtils'
import { loadSalesMonth, loadSfPostMonth, saveSalesDays } from '../bkSalesData'
import { BIZ_INPUTS, bizDayRow, bizDaysFromRows, bizTotals, postMapFromRows } from '../bkSalesUtils'
import { MoneyInput, Notice, StoreTabs, YearMonthPicker } from '../bkUi'
import BizExportModal from './BizExportModal'

const fmtCount = (n) => (n === null || n === undefined ? '' : round2(n).toLocaleString('en-AU', { maximumFractionDigits: 2 }))
const fmtAvgCount = (n) =>
  n === null || n === undefined ? '' : round2(n).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const th = 'border border-brand-100 px-1 py-1.5 text-[11px] font-semibold leading-tight text-gray-700'
const td = 'border border-gray-100 p-0'
// the heavier line between 日期 / 總營業額 / 總杯數 and the typed columns
const split = 'border-l-2 border-l-brand-300'

// 營業: each store's daily takings for one month. 總營業額 = POS + Self O +
// CV × 4 and 總杯數 = P杯數 + SO杯數 are computed; POS, CV, Self O and the two
// cup counts are typed — except POS for a store linked to SF, which is SF's
// O.POST. Self O also feeds that store's Self order kiosk column in SF.
export default function BizTab({ stores, topActive = true }) {
  const today = brisbaneToday()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)
  const [days, setDays] = useState({})
  const [postMap, setPostMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [exportMode, setExportMode] = useState(null) // 'excel' | 'week' | null

  const store = stores.find((s) => s.id === storeId) ?? stores[0] ?? null
  const linked = !!store?.sf_store_id
  const sfStoreId = store?.sf_store_id ?? null

  // The month's saved data. Changing store / month replaces whatever is on
  // screen (the change handlers below already asked about unsaved edits).
  useEffect(() => {
    if (!store) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setMsg('')
      try {
        const [rows, posts] = await Promise.all([
          loadSalesMonth(store.id, year, month),
          sfStoreId ? loadSfPostMonth(sfStoreId, year, month) : Promise.resolve([]),
        ])
        if (cancelled) return
        setDays(bizDaysFromRows(rows))
        setPostMap(postMapFromRows(posts))
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
  }, [store?.id, sfStoreId, year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  // SF's O.POST can change while this tab is hidden — re-read it when coming back.
  useEffect(() => {
    if (!topActive || !sfStoreId) return
    let cancelled = false
    loadSfPostMonth(sfStoreId, year, month)
      .then((rows) => !cancelled && setPostMap(postMapFromRows(rows)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [topActive, sfStoreId, year, month])

  const leaveOk = useCallback(
    () => !dirty || window.confirm('這個月的營業有未儲存的變更，確定要離開並捨棄嗎？'),
    [dirty]
  )

  const dates = useMemo(() => monthDates(year, month), [year, month])
  const rows = useMemo(
    () => dates.map((date) => ({ date, ...bizDayRow(days[date], linked ? (postMap[date] ?? null) : undefined) })),
    [dates, days, postMap, linked]
  )
  const { total, average } = useMemo(() => bizTotals(rows), [rows])

  function setField(date, field, value) {
    setDays((prev) => ({ ...prev, [date]: { ...(prev[date] ?? {}), [field]: value } }))
    setDirty(true)
    setMsg('')
  }

  async function save() {
    setSaving(true)
    setError('')
    setMsg('')
    try {
      await saveSalesDays(store.id, days, { linked })
      setDirty(false)
      setMsg('已儲存。')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Enter moves to the same column on the next day, like a spreadsheet.
  function onKeyDown(e, rowIdx, key) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = e.currentTarget.closest('table')?.querySelector(`[data-biz="${rowIdx + 1}:${key}"]`)
    if (next) {
      next.focus()
      next.select?.()
    }
  }

  if (!store) {
    return (
      <Notice kind="info">還沒有任何營業分店。請先到 系統設置 › 營業 › 分店管理 新增分店。</Notice>
    )
  }

  const status = dirty ? { color: 'brand', text: '有未儲存的變更' } : null
  const moneyCell = (v) => <div className="px-1 py-1 text-right tabular-nums text-gray-700">{fmtMoney(v)}</div>

  return (
    <div className="space-y-3">
      <StoreTabs
        stores={stores}
        storeId={store.id}
        onChange={(id) => {
          if (id !== store.id && leaveOk()) setStoreId(id)
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-brand-900">{store.name}</span>
        <YearMonthPicker
          year={year}
          month={month}
          onChange={(v) => {
            if (leaveOk()) {
              setYear(v.year)
              setMonth(v.month)
            }
          }}
        />
        {status && <Badge color={status.color}>{status.text}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={save} disabled={saving || loading || !dirty}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
          <div className="relative">
            <Button variant="secondary" onClick={() => setMenuOpen((v) => !v)}>
              匯出 ▾
            </Button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-lg border border-brand-100 bg-white shadow-lg">
                {[
                  ['excel', 'Excel 匯出'],
                  ['week', '週匯出'],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      setExportMode(mode)
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {linked && (
        <Notice kind="info">
          這間分店的 POS 直接讀 Sales figure 的 O.POST（不能在這裡改）。這裡的 Self O 是 Sales figure 的 Self order kiosk 的預設值；SF 那邊可以手動改，兩邊不一致時 SF 會顯示警示。
        </Notice>
      )}
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-brand-100">
          <table className="w-full table-fixed border-collapse text-[13px]" style={{ minWidth: 720 }}>
            <colgroup>
              <col style={{ width: 70 }} />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <th className={`${th} sticky left-0 z-30 bg-brand-100 text-left`}>日期</th>
                <th className={`${th} bg-brand-100`}>
                  總營業額
                  <div className="text-[10px] font-normal text-gray-500">= POS + Self O + CV×4</div>
                </th>
                <th className={`${th} bg-brand-100`}>
                  總杯數
                  <div className="text-[10px] font-normal text-gray-500">= P杯數 + SO杯數</div>
                </th>
                {BIZ_INPUTS.map(({ key, label }, i) => (
                  <th key={key} className={`${th} bg-sky-50 ${i === 0 ? split : ''}`}>
                    {label}
                    {key === 'pos' && linked && <div className="text-[10px] font-normal text-gray-500">SF 的 O.POST</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => {
                const r = rows[i]
                const day = days[date] ?? {}
                const weekendBg = isWeekend(date) ? 'bg-gray-50' : 'bg-white'
                return (
                  <tr key={date} className={weekendBg}>
                    <td className={`${td} sticky left-0 z-10 whitespace-nowrap px-1.5 py-1 ${weekendBg}`}>
                      <span className="font-medium">{Number(date.slice(8))}</span>{' '}
                      <span className="text-[11px] text-gray-400">{weekdayOf(date)}</span>
                    </td>
                    <td className={td}>
                      <div className="px-1 py-1 text-right font-medium tabular-nums text-gray-700" title="POS + Self O + CV × 4">
                        {fmtMoney(r.total)}
                      </div>
                    </td>
                    <td className={td}>
                      <div className="px-1 py-1 text-right font-medium tabular-nums text-gray-700" title="P杯數 + SO杯數">
                        {fmtCount(r.cups)}
                      </div>
                    </td>
                    {BIZ_INPUTS.map(({ key, field, money }, c) => (
                      <td key={key} className={`${td} bg-sky-50/40 ${c === 0 ? split : ''}`}>
                        {key === 'pos' && linked ? (
                          <div className="px-1 py-1 text-right tabular-nums text-gray-700" title="來自 Sales figure 的 O.POST">
                            {fmtMoney(r.pos)}
                          </div>
                        ) : (
                          <MoneyInput
                            value={day[field]}
                            onChange={(v) => setField(date, field, v)}
                            allowNegative={false}
                            className="!px-1 !text-[13px]"
                            onBlur={
                              money
                                ? () => {
                                    // money cells settle to two decimals when you leave them
                                    const n = Number(day[field])
                                    if (day[field] !== '' && day[field] !== undefined && Number.isFinite(n)) {
                                      const fixed = (Math.round(n * 100) / 100).toFixed(2)
                                      if (fixed !== day[field]) setField(date, field, fixed)
                                    }
                                  }
                                : undefined
                            }
                            data-biz={`${i}:${key}`}
                            onKeyDown={(e) => onKeyDown(e, i, key)}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              {[
                ['Total', total, fmtCount],
                ['平均', average, fmtAvgCount],
              ].map(([label, src, countFmt]) => (
                <tr key={label} className="bg-brand-50 font-semibold">
                  <td className={`${td} sticky left-0 z-30 bg-brand-50 px-1.5 py-1.5`} title={label === '平均' ? '用這個月已有資料的天數算每日平均' : undefined}>
                    {label}
                  </td>
                  <td className={td}>{moneyCell(src.total)}</td>
                  <td className={td}>
                    <div className="px-1 py-1 text-right tabular-nums">{countFmt(src.cups)}</div>
                  </td>
                  {BIZ_INPUTS.map(({ key, money }, c) => (
                    <td key={key} className={`${td} ${c === 0 ? split : ''}`}>
                      {money ? moneyCell(src[key]) : <div className="px-1 py-1 text-right tabular-nums">{countFmt(src[key])}</div>}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}

      <BizExportModal open={!!exportMode} mode={exportMode ?? 'excel'} stores={stores} year={year} month={month} onClose={() => setExportMode(null)} />
    </div>
  )
}
