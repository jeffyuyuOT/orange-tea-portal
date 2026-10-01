import { useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import { useClockInOut } from '../../../lib/useClockInOut'
import QrScannerModal from './QrScannerModal'
import ClockFeedbackModal from './ClockFeedbackModal'
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
  // Jeff, 2026-10-01: this tab's own scan/submit logic moved into
  // useClockInOut (src/lib/useClockInOut.js) so the new header shortcut in
  // AppShell.jsx could reuse the exact same flow instead of a second,
  // easy-to-drift copy of it.
  const { lastEvent, isClockedIn, showScanner, feedback, dismissFeedback, openScanner, closeScanner, handleScan } = useClockInOut(
    profileId,
    accessibleStores
  )

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

      {/* Jeff, 2026-10-02: disabled while `feedback` is up (the result modal
          below is still open) — this is the actual enforcement of "小視窗
          彈出沒有按掉前，沒辦法再scan一次": the button can't be tapped again
          until OK is pressed on the previous result, so a staff member who
          lingers in front of the camera can't fire off a second scan before
          they've even seen whether the first one worked. */}
      <Button className="!px-6 !py-3 text-base" onClick={openScanner} disabled={!!feedback}>
        📷 Scan to {isClockedIn ? 'Clock Out' : 'Clock In'}
      </Button>

      {showScanner && <QrScannerModal onScan={handleScan} onClose={closeScanner} />}
      {feedback && <ClockFeedbackModal feedback={feedback} onClose={dismissFeedback} />}
    </div>
  )
}
