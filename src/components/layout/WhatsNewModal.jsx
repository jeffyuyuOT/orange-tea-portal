import Modal from '../ui/Modal'

// Jeff, 2026-11-10: the "What's new" popup — see lib/releaseNotes.js for where the list comes
// from and when AppShell.jsx shows it. Closing it any way (Got it, ✕, tapping outside) counts
// as having seen everything listed.
export default function WhatsNewModal({ notes, onDone }) {
  return (
    <Modal
      open
      onClose={onDone}
      title="🎉 What's new"
      footer={
        <button onClick={onDone} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Got it
        </button>
      }
    >
      <ul className="space-y-4">
        {notes.map((n) => (
          <li key={n.id}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold text-gray-900">{n.title}</h4>
              <span className="shrink-0 text-[11px] text-gray-400">{n.date}</span>
            </div>
            <p className="mt-0.5 text-sm text-gray-600">{n.body}</p>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
