import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Badge from '../../../../components/ui/Badge'
import LoadingSpinner, { EmptyState } from '../../../../components/ui/LoadingSpinner'
import { buildColumns, dMapFromRows, inactiveIdsWithData, monthLabel, sfDaysFromRows } from '../bkUtils'
import { listSfMonths, loadCashDays, loadPaymentTypes, loadSfMonth } from '../bkData'
import { exportSfXlsx } from '../bkExcel'
import { loadSalesMonth } from '../bkSalesData'
import { selfOMapFromRows } from '../bkSalesUtils'
import { Notice, inputCls } from '../bkUi'

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour12: false }) : '')

// One line per month (the latest state), for one store at a time. Starts on
// the store the SF tab is showing; the dropdown can switch.
export default function SfHistory({ stores, salesStores, sfStoreId, active, refreshKey, onLoad }) {
  const [storeId, setStoreId] = useState(sfStoreId)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [yearFilter, setYearFilter] = useState(0)
  const [monthFilter, setMonthFilter] = useState(0)

  // Coming back to this tab re-anchors on the SF tab's store and re-reads.
  useEffect(() => {
    if (active) setStoreId(sfStoreId)
  }, [active, sfStoreId])

  useEffect(() => {
    if (!active || !storeId) return
    let cancelled = false
    setLoading(true)
    setError('')
    listSfMonths(storeId)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [active, storeId, refreshKey])

  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a), [rows])
  const shown = rows.filter((r) => (!yearFilter || r.year === yearFilter) && (!monthFilter || r.month === monthFilter))
  const storeName = stores.find((s) => s.id === storeId)?.name ?? ''

  async function exportRow(r) {
    setError('')
    try {
      // A store linked to the 營業 tab: its empty Self order kiosk days fall
      // back to 營業's Self O, same as the sheet.
      const biz = salesStores?.find((s) => s.sf_store_id === storeId) ?? null
      const [types, sf, cash, bizRows] = await Promise.all([
        loadPaymentTypes(storeId),
        loadSfMonth(storeId, r.year, r.month),
        loadCashDays(storeId, r.year, r.month),
        biz ? loadSalesMonth(biz.id, r.year, r.month) : Promise.resolve(null),
      ])
      const days = sfDaysFromRows(sf.days)
      await exportSfXlsx({
        storeName,
        year: r.year,
        month: r.month,
        columns: buildColumns(types, inactiveIdsWithData(types, days)),
        days,
        dMap: dMapFromRows(cash),
        kioskMap: bizRows ? selfOMapFromRows(bizRows) : undefined,
      })
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select className={inputCls} value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value)} aria-label="Store">
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className={inputCls} value={yearFilter} onChange={(e) => setYearFilter(Number(e.target.value))} aria-label="Year">
          <option value={0}>全部年份</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
        <select className={inputCls} value={monthFilter} onChange={(e) => setMonthFilter(Number(e.target.value))} aria-label="Month">
          <option value={0}>全部月份</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m} 月
            </option>
          ))}
        </select>
      </div>

      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

      {loading ? (
        <LoadingSpinner />
      ) : shown.length === 0 ? (
        <EmptyState label="沒有符合的SF紀錄。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-100">
          <table className="min-w-full text-sm">
            <thead className="bg-brand-100 text-left text-xs text-gray-700">
              <tr>
                <th className="px-3 py-2">月份</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2">提交時間</th>
                <th className="px-3 py-2">最後更新</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{monthLabel(r.year, r.month)}</td>
                  <td className="px-3 py-2">
                    <Badge color={r.status === 'submitted' ? 'green' : 'red'}>{r.status === 'submitted' ? '已提交' : '未提交'}</Badge>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{fmtTime(r.submitted_at)}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtTime(r.updated_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => onLoad({ storeId, year: r.year, month: r.month })}>
                        載入
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={r.status !== 'submitted'}
                        title={r.status === 'submitted' ? '' : '只有已提交的SF才能匯出'}
                        onClick={() => exportRow(r)}
                      >
                        匯出
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
