import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { Field, Notice, inputCls } from '../bkUi'
import { brisbaneTodayStr, monthStart } from '../bkUtils'
import { addDays, datesBetween, dmy, isDateStr, lastDayOfMonth, mondayOnOrBefore } from '../bkSalesUtils'
import { buildBizWeekImage, downloadBizWeekImageBlob, exportBizExcel, exportBizWeek } from '../bkSalesExcel'

const MAX_DAYS = 366

// 匯出 for the 營業 tab. mode 'excel': pick stores and a date range (start date,
// end date defaulting to the end of the month on screen but editable); the
// file has one tab per store. mode 'week': pick which Monday the week starts
// on and the stores; the file is the side-by-side weekly report — plus, Jeff
// 2026-10-25, an image version of that same report (`copyImage` below) that
// copies straight to the clipboard so it can be pasted directly into a LINE
// chat instead of attaching the .xlsx.
export default function BizExportModal({ open, mode, stores, year, month, onClose }) {
  const [checked, setChecked] = useState(() => new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [monday, setMonday] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Image-copy state, 'week' mode only. `copyState`: null (nothing tried
  // yet) | 'copied' (clipboard write succeeded) | 'unsupported' (this
  // browser/context won't let a page write an image to the clipboard —
  // Safari/older browsers, or a non-HTTPS context — so the preview + a
  // plain download link are shown instead).
  const [preview, setPreview] = useState(null) // { dataUrl, blob, filename, width, height }
  const [copyState, setCopyState] = useState(null)

  // Jeff, 2026-10-25: "選從哪一個周一開始能用一般選日期的日曆嗎? 因為現在下拉
  // 方式資料越多越拉很長" — was a <select> listing the last 60 Mondays
  // (newest first), which only grows every week; now a plain date input,
  // snapped to that date's own Monday (see setMonday below) so you never
  // actually need to pick the exact Monday — pick any day in the target
  // week.
  const thisMonday = useMemo(() => mondayOnOrBefore(brisbaneTodayStr()), [])
  const lastMonday = useMemo(() => addDays(thisMonday, -7), [thisMonday])

  useEffect(() => {
    if (!open) return
    setChecked(new Set(stores.map((s) => s.id)))
    setFrom(monthStart(year, month))
    setTo(lastDayOfMonth(year, month))
    setMonday(lastMonday) // last week's Monday: the usual one to report on
    setError('')
    setBusy(false)
    setPreview(null)
    setCopyState(null)
  }, [open, stores, year, month, lastMonday])

  // A stale preview (from a different week/store selection) would be
  // misleading if left on screen — drop it the moment either changes, so
  // "複製圖片" always has to be pressed again for the selection actually
  // showing.
  useEffect(() => {
    setPreview(null)
    setCopyState(null)
  }, [monday, checked])

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
      if (mode === 'excel') {
        await exportBizExcel({ stores: picked, from, to })
        onClose()
      } else {
        // Unlike the 'excel' mode, this doesn't close the modal — 週匯出 now
        // also offers 複製圖片 right below, so downloading the Excel file
        // shouldn't dismiss the chance to also copy the image version.
        await exportBizWeek({ stores: picked, monday })
      }
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function copyImage() {
    setError('')
    if (picked.length === 0) return setError('請至少勾選一間分店。')
    setBusy(true)
    setCopyState(null)
    try {
      const built = await buildBizWeekImage({ stores: picked, monday })
      setPreview(built)
      if (navigator.clipboard?.write && typeof window.ClipboardItem === 'function') {
        try {
          await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': built.blob })])
          setCopyState('copied')
        } catch {
          // Most often a browser that only allows clipboard-image writes
          // from a real user gesture in a secure (HTTPS) context, or one
          // that doesn't support it at all — the preview + 下載圖片 below
          // is the fallback either way.
          setCopyState('unsupported')
        }
      } else {
        setCopyState('unsupported')
      }
    } catch (e) {
      setError(`產生圖片失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'excel' ? 'Excel 匯出' : '週匯出'}
      extraWide={mode === 'week'}
      footer={
        mode === 'excel' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button onClick={run} disabled={busy || picked.length === 0}>
              {busy ? '匯出中…' : '匯出'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button variant="secondary" onClick={run} disabled={busy || picked.length === 0}>
              {busy ? '匯出中…' : '下載 Excel'}
            </Button>
            <Button onClick={copyImage} disabled={busy || picked.length === 0}>
              {busy ? '產生圖片中…' : '📋 複製圖片'}
            </Button>
          </>
        )
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
          <Field
            label="哪一個星期一開始"
            hint={
              monday
                ? `${dmy(monday)}（週一）到 ${dmy(addDays(monday, 6))}（週日）` +
                  (monday === thisMonday ? '（本週）' : monday === lastMonday ? '（上週）' : '')
                : ''
            }
          >
            <input
              type="date"
              className={inputCls}
              value={monday}
              // Picking any day snaps to that week's own Monday, so there's
              // no need to land on a Monday exactly — the calendar picker
              // itself has no day-of-week filter to enforce that.
              onChange={(e) => {
                if (e.target.value) setMonday(mondayOnOrBefore(e.target.value))
              }}
            />
          </Field>
        )}

        {mode === 'excel' && (
          <p className="text-xs text-gray-400">每間分店一個分頁；P杯數、POS、CV、Self O、SO杯數 與 日期、總營業額、總杯數 之間用粗線隔開。</p>
        )}

        {mode === 'week' && copyState === 'copied' && <Notice kind="ok">圖片已複製，可以直接到 LINE 貼上了。</Notice>}
        {mode === 'week' && copyState === 'unsupported' && (
          <Notice kind="info">這個瀏覽器沒辦法直接複製圖片——長按（手機）或右鍵（電腦）下面的圖片即可複製，或用「下載圖片」。</Notice>
        )}
        {mode === 'week' && preview && (
          <div>
            <div className="overflow-x-auto rounded-lg border border-brand-100 bg-gray-50 p-2">
              <img
                src={preview.dataUrl}
                alt="週報預覽"
                width={preview.width}
                height={preview.height}
                className="block"
                style={{ width: preview.width, height: preview.height }}
              />
            </div>
            <div className="mt-2 text-right">
              <Button
                variant="secondary"
                className="!px-3 !py-1.5 text-xs"
                onClick={() => downloadBizWeekImageBlob(preview.blob, preview.filename)}
              >
                下載圖片
              </Button>
            </div>
          </div>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  )
}
