import Modal from '../ui/Modal'

// Jeff, 2026-11-11: shown by AppShell.jsx when a newer version of the app is available and the
// admin switch (Admin Center > System Setting > Update Popup) is on. ✕ / tapping outside just
// closes it until the next time the app is opened.
export default function UpdatePromptModal({ busy, message, onUpdateNow, onLater, onDismiss }) {
  return (
    <Modal
      open
      onClose={busy ? undefined : onDismiss}
      title="🔄 New version available"
      footer={
        <>
          <button
            onClick={onLater}
            disabled={busy}
            className="rounded-lg border border-brand-200 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            Update when I close the app
          </button>
          <button
            onClick={onUpdateNow}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Updating…' : 'Update now'}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-700">
        A new version of the app is ready. "Update now" refreshes the app right away. "Update when I close the app"
        waits until you switch away from the app or lock your phone, so you can keep working.
      </p>
      {message && <p className="mt-3 text-sm text-gray-600">{message}</p>}
    </Modal>
  )
}
