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
  return { header: ['Hour', sheetHeader(view)], rows, total: ['Total', money2(total)] }
}
// Draw the table (with grid lines) onto a canvas -> PNG, for chat apps like LINE that only paste images.
function tablePng(view) {
  const { header, rows, total } = sheetData(view)
  const all = [header, ...rows, ['', ''], total]
  const sc = 2, rowH = 26, w0 = 70, w1 = 90
  const c = document.createElement('canvas')
  c.width = (w0 + w1) * sc
  c.height = all.length * rowH * sc
  const g = c.getContext('2d')
  g.scale(sc, sc)
  g.fillStyle = '#fff'
  g.fillRect(0, 0, w0 + w1, all.length * rowH)
  g.font = '14px Calibri, Arial, sans-serif'
  g.textBaseline = 'middle'
  all.forEach((r, i) => {
    const y = i * rowH
    const isTotal = i === all.length - 1
    if (i === 0) {
      g.fillStyle = '#f2f2f2'
      g.fillRect(0, y, w0 + w1, rowH)
    }
    g.fillStyle = '#000'
    g.font = `${i === 0 || isTotal ? 'bold ' : ''}14px Calibri, Arial, sans-serif`
    g.textAlign = i === 0 ? 'left' : 'right'
    g.fillText(r[0], i === 0 ? 8 : w0 - 8, y + rowH / 2)
    g.font = `${i === 0 || isTotal ? 'bold ' : ''}14px Calibri, Arial, sans-serif`
    g.textAlign = 'right'
    g.fillText(r[1], w0 + w1 - 8, y + rowH / 2)
  })
  g.strokeStyle = '#000'
  g.lineWidth = 1
  for (let i = 0; i <= all.length; i++) {
    g.beginPath(); g.moveTo(0, i * rowH + 0.5); g.lineTo(w0 + w1, i * rowH + 0.5); g.stroke()
  }
  for (const x of [0.5, w0 + 0.5, w0 + w1 - 0.5]) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, all.length * rowH); g.stroke()
  }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('無法產生圖片'))), 'image/png'))
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
  // LINE and other chat apps only take images, so copy the table as a PNG with grid lines.
  async function copyTableImage() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': tablePng(view) })])
      setMsg('已複製表格圖片（含格線），可以直接貼到 LINE。')
    } catch {
      try {
        const blob = await tablePng(view)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'hour-table.png'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
        setMsg('瀏覽器不允許直接複製，已改成下載表格圖片。')
      } catch (e) {
        setMsg(e.message)
      }
    }
  }
  const sheet = view?.values && view.days > 0 ? sheetData(view) : null
  return (
    <Modal
      open={!!view}
      wide
      onClose={() => (setMsg(''), onClose())}
      title={view?.title ?? ''}
    >
      <div className="sticky top-0 z-10 -mx-5 -mt-4 mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 bg-white px-5 py-2">
        <span className="text-xs text-green-700">{msg}</span>
        <div className="flex gap-2">
          {view?.values && view.days > 0 && (
            <>
              <Button variant="secondary" onClick={copyTableImage}>
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
            <p className="text-xs text-gray-400">這張表的格式跟 Excel 的 Hour 表一樣，按「複製表格」可複製成帶格線的圖片，直接貼上。</p>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
