import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { Field, Notice, inputCls } from '../bkUi'
import { brisbaneTodayStr, monthStart } from '../bkUtils'
import { addDays, datesBetween, dmy, isDateStr, lastDayOfMonth, mondayOnOrBefore } from '../bkSalesUtils'
import { exportBizExcel, exportBizWeek } from '../bkSalesExcel'

const MAX_DAYS = 366

// 匯出 for the 營業 tab. mode 'excel': pick stores and a date range (start date,
// end date defaulting to the end of the month on screen but editable); the
// file has one tab per store. mode 'week': pick which Monday the week starts
// on and the stores; the file is the side-by-side weekly report.
export default function BizExportModal({ open, mode, stores, year, month, onClose }) {
  const [checked, setChecked] = useState(() => new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [monday, setMonday] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The last 60 Mondays, newest first (this week's Monday included).
  const mondays = useMemo(() => {
    const thisMonday = mondayOnOrBefore(brisbaneTodayStr())
    return Array.from({ length: 60 }, (_, i) => addDays(thisMonday, -7 * i))
  }, [])

  useEffect(() => {
    if (!open) return
    setChecked(new Set(stores.map((s) => s.id)))
    setFrom(monthStart(year, month))
    setTo(lastDayOfMonth(year, month))
    setMonday(mondays[1]) // last week's Monday: the usual one to report on
    setError('')
    setBusy(false)
  }, [open, stores, year, month, mondays])

  const picked = stores.filter((s) => checked.has(s.id))

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function run() {
    setError('')
    if (picked.length === 0) return setError('請至少勾選一間分店。')
    if (mode === 'excel') {
      if (!isDateStr(from) || !isDateStr(to)) return setError('請選擇開始和結束日期。')
      if (from > to) return setError('開始日期不能晚於結束日期。')
      if (datesBetween(from, to).length > MAX_DAYS) return setError(`日期區間最多 ${MAX_DAYS} 天。`)
    }
    setBusy(true)
    try {
      if (mode === 'excel') await exportBizExcel({ stores: picked, from, to })
      else await exportBizWeek({ stores: picked, monday })
      onClose()
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'excel' ? 'Excel 匯出' : '週匯出'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={run} disabled={busy || picked.length === 0}>
            {busy ? '匯出中…' : '匯出'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-gray-700">分店</span>
            <span className="space-x-3 text-xs">
              <button type="button" className="text-brand-600 hover:underline" onClick={() => setChecked(new Set(stores.map((s) => s.id)))}>
                全選
              </button>
              <button type="button" className="text-brand-600 hover:underline" onClick={() => setChecked(new Set())}>
                全不選
              </button>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {stores.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>

        {mode === 'excel' ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="開始日期">
              <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="結束日期" hint="預設為月底，可以自己改">
              <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="哪一個星期一開始" hint={monday ? `${dmy(monday)}（週一）到 ${dmy(addDays(monday, 6))}（週日）` : ''}>
            <select className={`${inputCls} w-full`} value={monday} onChange={(e) => setMonday(e.target.value)}>
              {mondays.map((m, i) => (
                <option key={m} value={m}>
                  {dmy(m)}
                  {i === 0 ? '（本週）' : i === 1 ? '（上週）' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        {mode === 'excel' && (
          <p className="text-xs text-gray-400">每間分店一個分頁；P杯數、POS、CV、Self O、SO杯數 與 日期、總營業額、總杯數 之間用粗線隔開。</p>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  )
}
