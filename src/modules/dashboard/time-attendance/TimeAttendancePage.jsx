import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import { getLastEvent, parseAndValidateQrPayload, submitClockEvent } from '../../../lib/attendance'
import QrScannerModal from './QrScannerModal'
import AttendanceLogTable from './AttendanceLogTable'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'

export default function TimeAttendancePage() {
  const { profile, accessibleStores } = useAuth()
  const [tab, setTab] = useState('clock') // 'clock' | 'logs'

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
        {[
          { key: 'clock', label: 'Clock In / Out' },
          { key: 'logs', label: 'Attendance Logs' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'clock' ? (
        <ClockInOutTab profileId={profile?.id} accessibleStores={accessibleStores} />
      ) : (
        <AttendanceLogTable profileId={profile?.id} />
      )}
    </div>
  )
}

function ClockInOutTab({ profileId, accessibleStores }) {
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

  async function handleScan(raw) {
    if (handledRef.current) return
    handledRef.current = true
    setShowScanner(false)

    const parsed = parseAndValidateQrPayload(raw)
    if (!parsed) {
      setFeedback({ type: 'error', text: "That code has expired or isn't a valid Orange Tea clock-in code — please scan the screen again." })
      return
    }
    if (!accessibleStores.some((s) => s.id === parsed.storeId)) {
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

  const isClockedIn = lastEvent?.event_type === 'clock_in'

  return (
    <div className="mx-auto max-w-md text-center">
      {lastEvent === undefined ? (
        <LoadingSpinner />
      ) : (
        <div className="mb-6 rounded-xl border border-brand-100 bg-white p-6">
          <p className="text-sm text-gray-500">Current status</p>
          <p className={`mt-1 text-2xl font-semibold ${isClockedIn ? 'text-green-600' : 'text-gray-800'}`}>
            {isClockedIn ? 'Clocked In' : 'Clocked Out'}
          </p>
          {lastEvent && (
            <p className="mt-1 text-xs text-gray-400">
              Since {new Date(lastEvent.occurred_at).toLocaleString()}
            </p>
          )}
        </div>
      )}

      <Button className="!px-6 !py-3 text-base" onClick={openScanner}>
        📷 Scan to {isClockedIn ? 'Clock Out' : 'Clock In'}
      </Button>

      {feedback && (
        <p className={`mt-4 text-sm ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{feedback.text}</p>
      )}

      {showScanner && <QrScannerModal onScan={handleScan} onClose={() => setShowScanner(false)} />}
    </div>
  )
}
