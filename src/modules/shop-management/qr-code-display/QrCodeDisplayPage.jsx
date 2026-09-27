import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useAuth } from '../../../lib/AuthContext'
import { buildQrPayload } from '../../../lib/attendance'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

const REFRESH_MS = 1000

// Meant to sit on a phone mounted in the store (see the qr_code_maker role
// in permissions.js) — nothing to click, nothing to configure, just a QR
// code that regenerates every second so staff can scan it from Time &
// Attendance > Clock In / Out to punch in/out. The code carries no secret;
// see src/lib/attendance.js for how a scan is validated.
//
// Deliberately NOT a "press Generate, code disappears after 10s" flow — that
// would mean someone has to walk up and press a button before every single
// scan, defeating the point of a kiosk phone anyone can scan any time. This
// stays a continuously-refreshing display instead, with three things to
// make sure it never looks (or actually goes) stale:
//   1. A Screen Wake Lock so the mounted phone's screen doesn't auto-sleep.
//   2. A forced redraw the instant the tab becomes visible again, in case
//      the browser throttled its timers while it was backgrounded.
//   3. A visible per-second progress ring so anyone glancing at it can tell
//      it's actively ticking rather than frozen.
// Belt-and-suspenders: even if a redraw were ever missed, the scanner side
// rejects any code older than QR_FRESHNESS_MS (see src/lib/attendance.js),
// so a stale code just fails to scan rather than silently mis-recording.
export default function QrCodeDisplayPage() {
  const { currentStoreId, accessibleStores } = useAuth()
  const canvasRef = useRef(null)
  const wakeLockRef = useRef(null)
  const [now, setNow] = useState(new Date())
  const [msUntilRefresh, setMsUntilRefresh] = useState(REFRESH_MS)
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
    const drawId = setInterval(draw, REFRESH_MS)
    // Redraws the moment the ring hits 0 even between setInterval ticks —
    // and, combined with the visibilitychange handler below, guarantees a
    // fresh code as soon as the screen is looked at again rather than
    // waiting out whatever's left of a throttled interval.
    const tickId = setInterval(() => setMsUntilRefresh(Math.max(0, REFRESH_MS - (Date.now() - lastDraw))), 100)

    function onVisible() {
      if (document.visibilityState === 'visible') draw()
    }
    document.addEventListener('visibilitychange', onVisible)

    // Screen Wake Lock — keeps a phone mounted for this purpose from
    // dimming/locking on its own. Not supported in every browser; fails
    // silently where it isn't (the display still works, it just won't stop
    // the screen from sleeping on its own).
    async function requestWakeLock() {
      try {
        wakeLockRef.current = await navigator.wakeLock?.request('screen')
      } catch {
        // Ignore — e.g. unsupported browser, or battery saver blocking it.
      }
    }
    requestWakeLock()
    // Wake locks are released automatically when the tab is hidden, so
    // re-acquire it whenever the tab comes back into view.
    document.addEventListener('visibilitychange', requestWakeLock)

    return () => {
      cancelled = true
      clearInterval(drawId)
      clearInterval(tickId)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('visibilitychange', requestWakeLock)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [store])

  if (!store) {
    return <EmptyState label="No store selected — pick one above." />
  }

  const progress = 1 - msUntilRefresh / REFRESH_MS // 0 -> 1 each second

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-900">{store.name}</h1>
        <p className="text-sm text-gray-500">Scan to clock in / out — code refreshes every second</p>
      </div>
      <div className="relative">
        <canvas ref={canvasRef} className="rounded-xl border border-brand-100 bg-white p-3 shadow-sm" />
        {/* Thin live progress bar under the code — visual proof it's actively
            ticking, not frozen on an old code. */}
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-brand-100">
          <div className="h-full bg-brand-400" style={{ width: `${progress * 100}%`, transition: 'width 100ms linear' }} />
        </div>
      </div>
      <p className="text-lg font-mono text-brand-700">{now.toLocaleTimeString()}</p>
      <p className="text-xs text-gray-400">{now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
  )
}
