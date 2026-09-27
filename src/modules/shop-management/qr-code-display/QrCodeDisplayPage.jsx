import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useAuth } from '../../../lib/AuthContext'
import { buildQrPayload, QR_REFRESH_MS } from '../../../lib/attendance'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Meant to sit on a phone mounted in the store (see the qr_code_maker role
// in permissions.js) — nothing to click, nothing to configure, just a QR
// code that regenerates every QR_REFRESH_MS so staff can scan it from Time &
// Attendance > Clock In / Out to punch in/out. The code carries no secret;
// see src/lib/attendance.js for how a scan is validated.
//
// Deliberately NOT a "press Generate, code disappears after 10s" flow — that
// would mean someone has to walk up and press a button before every single
// scan, defeating the point of a kiosk phone anyone can scan any time. This
// stays a continuously-refreshing display instead, with two things to make
// sure it never looks (or actually goes) stale:
//   1. A forced redraw the instant the tab becomes visible again, in case
//      the browser throttled its timers while backgrounded, or the phone's
//      screen had locked itself and just got woken up — either way, the
//      moment someone looks at it again it's guaranteed current rather than
//      showing whatever was last on screen.
//   2. A visible progress bar so anyone glancing at it can tell it's
//      actively ticking rather than frozen.
// No Screen Wake Lock — if the phone's screen times out and locks on its
// own, that's fine; #1 above means the code is fresh again the instant the
// screen is woken and looked at, so there's nothing to force awake.
// Belt-and-suspenders: even if a redraw were ever missed, the scanner side
// rejects any code older than QR_FRESHNESS_MS (see src/lib/attendance.js),
// so a stale code just fails to scan rather than silently mis-recording.
export default function QrCodeDisplayPage() {
  const { currentStoreId, accessibleStores } = useAuth()
  const canvasRef = useRef(null)
  const [now, setNow] = useState(new Date())
  const [msUntilRefresh, setMsUntilRefresh] = useState(QR_REFRESH_MS)
  const store = accessibleStores.find((s) => s.id === currentStoreId)

  useEffect(() => {
    if (!store) return
    let cancelled = false
    let lastDraw = 0

    function draw() {
      if (cancelled || !canvasRef.current) return
      QRCode.toCanvas(canvasRef.current, buildQrPayload(store), { width: 360, margin: 2 }).catch(() => {})
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
  }, [store])

  if (!store) {
    return <EmptyState label="No store selected — pick one above." />
  }

  const progress = 1 - msUntilRefresh / QR_REFRESH_MS // 0 -> 1 each cycle

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-900">{store.name}</h1>
        <p className="text-sm text-gray-500">Scan to clock in / out — code refreshes every {QR_REFRESH_MS / 1000} seconds</p>
      </div>
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
