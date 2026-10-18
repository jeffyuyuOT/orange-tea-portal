import { useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import HourChart, { svgToPng } from './HourChart'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money2 = (n) => (Math.round(n * 100) / 100).toFixed(2)

// The lower half is laid out like Jeff's own "SP hour" sheet so it pastes straight in:
//   SP hour | 16-Oct        (a day: d-Mon; several days averaged: 平均)
//   10      | 9.20          (hours with no sales stay blank)
//   …
//   (blank row)
//   Total   | 3378.08
function sheetHeader(view) {
  if (view.sheetLabel) return view.sheetLabel
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(view.title ?? '')
  if (view.days === 1 && m) return `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]}`
  return view.days > 1 ? `平均（${view.days} 天）` : (view.title ?? '')
}
function sheetData(view) {
  const rows = view.hours.map((h) => {
    const v = view.values[h] ?? 0
    return [String(h), v > 0 ? money2(v) : '']
  })
  const total = view.hours.reduce((sum, h) => sum + (view.values[h] ?? 0), 0)
  return { header: ['SP hour', sheetHeader(view)], rows, total: ['Total', money2(total)] }
}
// Tab-separated, so Excel / Google Sheets drop it into cells.
function sheetText(view) {
  const { header, rows, total } = sheetData(view)
  return [header, ...rows, [''], total].map((r) => r.join('\t')).join('\n')
}

// The hourly 營業額 of one day, or the per-hour average of several days
// (history › 週統計). `view` = { title, note, hours:[…], values:{hour:dollars}, days } | { title, loading } | null.
export default function HourBreakdown({ view, onClose }) {
  const svgRef = useRef(null)
  const [msg, setMsg] = useState('')

  async function makePng() {
    return svgToPng(svgRef.current)
  }
  async function download() {
    try {
      const blob = await makePng()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${(view.title ?? '小時營業額').replace(/[\\/:*?"<>|\s]+/g, '_')}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      setMsg('已下載圖片。')
    } catch (e) {
      setMsg(e.message)
    }
  }
  // Copy the chart as an image so it can be pasted straight into a chat / email;
  // if the browser refuses, fall back to downloading the PNG.
  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': makePng() })])
      setMsg('已複製圖片，可以直接貼上。')
    } catch {
      await download()
      setMsg('瀏覽器不允許直接複製，已改成下載圖片。')
    }
  }
  // Copy the lower table as tab-separated text, for pasting into a spreadsheet.
  async function copyTable() {
    const text = sheetText(view)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Older / stricter browsers: select a hidden textarea and use the legacy copy command.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      if (!ok) {
        setMsg('瀏覽器不允許複製。')
        return
      }
    }
    setMsg('已複製表格，可以直接貼到 Excel。')
  }
  const sheet = view?.values && view.days > 0 ? sheetData(view) : null
  return (
    <Modal
      open={!!view}
      wide
      onClose={() => (setMsg(''), onClose())}
      title={view?.title ?? ''}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-green-700">{msg}</span>
          <div className="flex gap-2">
            {view?.values && view.days > 0 && (
              <>
                <Button variant="secondary" onClick={copyTable}>
                  複製表格
                </Button>
                <Button variant="secondary" onClick={copy}>
                  複製圖片
                </Button>
              </>
            )}
            <Button onClick={() => (setMsg(''), onClose())}>關閉</Button>
          </div>
        </div>
      }
    >
      {view?.loading && <LoadingSpinner />}
      {view?.message && <p className="text-sm text-gray-500">{view.message}</p>}
      {view?.values && (
        <div className="space-y-2">
          {view.note && <p className="text-xs text-gray-500">{view.note}</p>}
          {view.days === 0 ? (
            <p className="text-sm text-gray-500">這段時間沒有小時營業額資料。</p>
          ) : (
            <>
            <div className="overflow-hidden rounded-lg border border-brand-100">
              <HourChart ref={svgRef} title={view.title} subtitle={view.note} hours={view.hours} values={view.values} />
            </div>
            <div className="inline-block max-w-full overflow-hidden rounded-md border border-gray-300 bg-white">
              <table className="border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100 text-xs font-bold text-gray-800">
                    <th className="min-w-[5rem] border border-gray-300 px-3 py-1.5 text-left">{sheet.header[0]}</th>
                    <th className="min-w-[7rem] border border-gray-300 px-3 py-1.5 text-right">{sheet.header[1]}</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map(([h, v]) => (
                    <tr key={h}>
                      <td className="border border-gray-200 px-3 py-1 text-right font-bold tabular-nums">{h}</td>
                      <td className="border border-gray-200 px-3 py-1 text-right tabular-nums">{v}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="h-6 border border-gray-200" />
                    <td className="border border-gray-200" />
                  </tr>
                  <tr className="font-bold">
                    <td className="border border-gray-300 px-3 py-1.5">{sheet.total[0]}</td>
                    <td className="border border-gray-300 px-3 py-1.5 text-right tabular-nums">{sheet.total[1]}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400">這張表的格式跟 Excel 的 SP hour 表一樣，按「複製表格」可直接貼上。</p>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
