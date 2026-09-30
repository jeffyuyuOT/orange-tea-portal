import { useEffect, useRef, useState } from 'react'
import { getLastEvent, parseAndValidateQrPayload, submitClockEvent } from './attendance'

// Jeff, 2026-10-01: "手機版的scan to check in按鈕能再做一個快捷鍵在選擇分店跟
// 姓名的中間嗎" — the scan-to-clock-in/out flow used to live entirely inside
// TimeAttendancePage.jsx's ClockInOutTab, so using it from anywhere else (the
// new header shortcut in AppShell.jsx, see the 2026-10-01 comment there)
// would have meant copy-pasting the same state machine and risking the two
// copies drifting apart. Pulled out into this one shared hook instead —
// ClockInOutTab and AppShell's header button both call it and just render
// their own UI around whatever it gives back.
//
// Same behavior as before: `feedback` auto-describes the punch that was just
// recorded (or why it was rejected) and is left for the caller to clear
// (ClockInOutTab clears it on the next `openScanner`; AppShell auto-dismisses
// its toast on a timer instead, since there's no persistent place on every
// page to leave it sitting).
export function useClockInOut(profileId, accessibleStores) {
  const [lastEvent, setLastEvent] = useState(undefined) // undefined = loading, null = never punched
  const [showScanner, setShowScanner] = useState(false)
  const [feedback, setFeedback] = useState(null) // { type: 'success'|'error', text }
  // Guards against QrScannerModal's onScan firing more than once (e.g. the
  // decode loop finding the same frame twice) before we've had a chance to
  // close it — without this a fast double-fire could submit two punches for
  // one scan.
  const handledRef = useRef(false)

  async function refreshStatus() {
    if (!profileId) return
    setLastEvent(await getLastEvent(profileId))
  }

  useEffect(() => {
    refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  function openScanner() {
    handledRef.current = false
    setFeedback(null)
    setShowScanner(true)
  }

  function closeScanner() {
    setShowScanner(false)
  }

  async function handleScan(raw) {
    if (handledRef.current) return
    handledRef.current = true
    setShowScanner(false)

    const parsed = parseAndValidateQrPayload(raw)
    if (!parsed) {
      setFeedback({ type: 'error', text: "That code has expired or isn't a valid Orange Tea clock-in code — please scan the screen again." })
      return
    }
    if (!accessibleStores?.some((s) => s.id === parsed.storeId)) {
      setFeedback({ type: 'error', text: `That code is for a store you don't have access to (${parsed.storeName || 'unknown store'}).` })
      return
    }

    const { error, eventType } = await submitClockEvent(profileId, parsed.storeId)
    if (error) {
      setFeedback({ type: 'error', text: 'Something went wrong recording that — please try again.' })
      return
    }
    setFeedback({
      type: 'success',
      text: `${eventType === 'clock_in' ? 'Clocked in' : 'Clocked out'} at ${parsed.storeName || 'store'} — ${new Date().toLocaleTimeString()}.`,
    })
    refreshStatus()
  }

  return {
    lastEvent,
    isClockedIn: lastEvent?.event_type === 'clock_in',
    showScanner,
    feedback,
    setFeedback,
    openScanner,
    closeScanner,
    handleScan,
  }
}
