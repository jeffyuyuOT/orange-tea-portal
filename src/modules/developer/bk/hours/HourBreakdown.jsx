import { useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import HourChart, { svgToPng } from './HourChart'

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
  return (
    <Modal
      open={!!view}
      wide
      onClose={() => (setMsg(''), onClose())}
      title={
        view?.nav ? (
          <span className="flex items-center gap-2">
            <span>{view.title}</span>
            <button
              type="button"
              onClick={view.nav.onPrev}
              className="rounded-full border border-brand-200 px-2 text-brand-700 hover:bg-brand-50"
              aria-label="上一間分店"
              title="上一間分店"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={view.nav.onNext}
              className="rounded-full border border-brand-200 px-2 text-brand-700 hover:bg-brand-50"
              aria-label="下一間分店"
              title="下一間分店"
            >
              ›
            </button>
          </span>
        ) : (
          view?.title ?? ''
        )
      }
    >
      <div className="sticky top-0 z-10 -mx-5 -mt-4 mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 bg-white px-5 py-2">
        <span className="text-xs text-green-700">{msg}</span>
        <div className="flex gap-2">
          {view?.values && view.days > 0 && (
            <>
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
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
