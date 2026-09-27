import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { QR_REFRESH_MS } from '../../lib/attendance'

// Shared canvas-drawing/timer plumbing behind both of this app's rotating
// QR displays — the store's own "2D Code" kiosk screen
// (QrCodeDisplayPage.jsx) and a person's own "My Staff ID" badge
// (MyStaffIdModal.jsx). Both need the exact same behavior: redraw a fresh
// code every QR_REFRESH_MS, force an immediate redraw the moment the tab/
// screen becomes visible again (in case a throttled timer or a locked
// screen left it stale), and show a small progress bar so it's visibly
// ticking rather than looking frozen. Pulling this into one place means
// that behavior can only ever drift by one component changing, not two.
//
// `buildPayload` is called fresh on every single draw (not memoized/called
// once) — each draw needs its own current timestamp baked in, see
// src/lib/attendance.js's buildQrPayload/buildStaffIdPayload.
export default function RotatingQrDisplay({ buildPayload, size = 300 }) {
  const canvasRef = useRef(null)
  const [now, setNow] = useState(new Date())
  const [msUntilRefresh, setMsUntilRefresh] = useState(QR_REFRESH_MS)

  useEffect(() => {
    let cancelled = false
    let lastDraw = 0

    function draw() {
      if (cancelled || !canvasRef.current) return
      QRCode.toCanvas(canvasRef.current, buildPayload(), { width: size, margin: 2 }).catch(() => {})
      lastDraw = Date.now()
      setNow(new Date())
    }

    draw()
    const drawId = setInterval(draw, QR_REFRESH_MS)
    // Redraws the moment the bar hits empty even between setInterval ticks —
    // and, combined with the visibilitychange handler below, guarantees a
    // fresh code as soon as the screen is looked at again rather than
    // waiting out whatever's left of a throttled interval.
    const tickId = setInterval(() => setMsUntilRefresh(Math.max(0, QR_REFRESH_MS - (Date.now() - lastDraw))), 200)

    function onVisible() {
      if (document.visibilityState === 'visible') draw()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(drawId)
      clearInterval(tickId)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // Restarts (and redraws immediately) whenever `buildPayload` itself
    // changes identity — which callers only do when what it encodes
    // actually changed (e.g. QrCodeDisplayPage passes a new one when the
    // selected store changes), not on this component's own internal ticks.
    // That mirrors the original store-display page's `[store]`-dependent
    // effect, so switching stores/profiles still redraws right away instead
    // of waiting out whatever's left of the old interval.
  }, [buildPayload, size])

  const progress = 1 - msUntilRefresh / QR_REFRESH_MS // 0 -> 1 each cycle

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <canvas ref={canvasRef} className="rounded-xl border border-brand-100 bg-white p-3 shadow-sm" />
        {/* Thin live progress bar under the code — visual proof it's actively
            ticking, not frozen on an old code. */}
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-brand-100">
          <div className="h-full bg-brand-400" style={{ width: `${progress * 100}%`, transition: 'width 200ms linear' }} />
        </div>
      </div>
      <p className="text-lg font-mono text-brand-700">{now.toLocaleTimeString()}</p>
      <p className="text-xs text-gray-400">{now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
  )
}
