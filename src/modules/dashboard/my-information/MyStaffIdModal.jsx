import { useAuth } from '../../../lib/AuthContext'
import { buildStaffIdPayload, QR_REFRESH_MS } from '../../../lib/attendance'
import Modal from '../../../components/ui/Modal'
import RotatingQrDisplay from '../../../components/ui/RotatingQrDisplay'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// A person's own rotating "Staff ID" badge, opened from the "My Staff ID"
// button at the top of My Information. The reverse direction of the
// store's own "2D Code" kiosk display (QrCodeDisplayPage.jsx): here THIS
// PERSON is proving who they are and which store they're currently at, and
// the store's kiosk phone scans them via its own "Scan Staff ID" button.
// Same rotating-canvas/timer plumbing as that kiosk display, via the shared
// RotatingQrDisplay, so this refreshes on the exact same QR_REFRESH_MS
// cadence and can't be reused from a screenshot (see
// src/lib/attendance.js's buildStaffIdPayload/parseAndValidateStaffIdPayload).
//
// Uses whichever store this person currently has selected (the same
// currentStoreId the rest of the app uses) — someone who works at more than
// one store is expected to switch to the right one before showing this.
export default function MyStaffIdModal({ onClose }) {
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const store = accessibleStores.find((s) => s.id === currentStoreId)
  const name = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()

  return (
    <Modal open onClose={onClose} title="My Staff ID">
      {!store ? (
        <EmptyState label="No store selected — pick one above." />
      ) : (
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
            <p className="text-sm text-gray-500">{store.name}</p>
          </div>
          <RotatingQrDisplay size={260} buildPayload={() => buildStaffIdPayload(profile, store)} />
          <p className="mt-1 max-w-xs text-center text-xs text-gray-400">
            Show this to a manager to confirm your identity — it refreshes every {QR_REFRESH_MS / 1000} seconds, so it can't be
            reused from a screenshot.
          </p>
        </div>
      )}
    </Modal>
  )
}
