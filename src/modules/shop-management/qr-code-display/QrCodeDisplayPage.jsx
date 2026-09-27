import { useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import { buildQrPayload, parseAndValidateStaffIdPayload, QR_REFRESH_MS } from '../../../lib/attendance'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import RotatingQrDisplay from '../../../components/ui/RotatingQrDisplay'
import QrScannerModal from '../../dashboard/time-attendance/QrScannerModal'

// Meant to sit on a phone mounted in the store (see the qr_code_maker role
// in permissions.js) — nothing to click for its main job, just a QR code
// that regenerates every QR_REFRESH_MS so staff can scan it from Time &
// Attendance > Clock In / Out to punch in/out. The code carries no secret;
// see src/lib/attendance.js for how a scan is validated. The rotating
// canvas/timer/progress-bar plumbing itself lives in the shared
// RotatingQrDisplay, since My Staff ID (MyStaffIdModal.jsx) needs the exact
// same behavior for a person's own badge.
//
// Deliberately NOT a "press Generate, code disappears after 10s" flow — that
// would mean someone has to walk up and press a button before every single
// scan, defeating the point of a kiosk phone anyone can scan any time. This
// stays a continuously-refreshing display instead.
//
// This same kiosk phone also doubles as the reader for the REVERSE
// direction — "Scan Staff ID" below lets whoever's standing at it scan a
// staff member's own rotating My Staff ID badge (My Information page) to
// confirm their name and which store they're at, e.g. for a relief/visiting
// staff member nobody on shift recognizes. Scanning never interrupts the
// store's own code above, which keeps refreshing underneath the whole time
// — closing the scan result just returns to looking at it, nothing to
// resume.
export default function QrCodeDisplayPage() {
  const { currentStoreId, accessibleStores } = useAuth()
  const store = accessibleStores.find((s) => s.id === currentStoreId)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null) // null | { name, storeName } | { error }

  function handleScan(raw) {
    setScanning(false)
    const parsed = parseAndValidateStaffIdPayload(raw)
    if (!parsed) {
      setScanResult({
        error: "That's not a valid Staff ID code, or it's expired — ask them to open My Staff ID again (it only stays valid for a few seconds) and try again.",
      })
      return
    }
    setScanResult({ name: parsed.name, storeName: parsed.storeName })
  }

  if (!store) {
    return <EmptyState label="No store selected — pick one above." />
  }

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-900">{store.name}</h1>
        <p className="text-sm text-gray-500">Scan to clock in / out — code refreshes every {QR_REFRESH_MS / 1000} seconds</p>
      </div>

      <RotatingQrDisplay size={360} buildPayload={() => buildQrPayload(store)} />

      <Button variant="secondary" onClick={() => setScanning(true)}>
        📷 Scan Staff ID
      </Button>

      {scanning && (
        <QrScannerModal
          title="Scan Staff ID"
          hint="Point the camera at the employee's My Staff ID code"
          onScan={handleScan}
          onClose={() => setScanning(false)}
        />
      )}

      {scanResult && (
        <Modal
          open
          onClose={() => setScanResult(null)}
          title="Staff ID"
          footer={<Button onClick={() => setScanResult(null)}>Done</Button>}
        >
          {scanResult.error ? (
            <p className="text-sm text-red-600">{scanResult.error}</p>
          ) : (
            <div className="py-2 text-center">
              <p className="text-lg font-semibold text-gray-900">{scanResult.name}</p>
              <p className="text-sm text-gray-500">{scanResult.storeName || 'No store on this badge'}</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
