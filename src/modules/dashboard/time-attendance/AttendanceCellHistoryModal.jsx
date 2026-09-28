import { format, parseISO } from 'date-fns'
import Modal from '../../../components/ui/Modal'

const ACTION_LABEL = { add: 'Added', edit: 'Edited', delete: 'Deleted' }
const TYPE_LABEL = { clock_in: 'Clock in', clock_out: 'Clock out' }

// Read-only — the "更改紀錄" popup Jeff asked for: who changed what, when,
// and why, for one (profile, store, date) cell. `edits` is already the
// slice of attendance_event_edits (migration 0062) for this exact cell,
// newest first — see AttendanceLogTable's editsByCell.
export default function AttendanceCellHistoryModal({ edits, storeName, date, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Edit history — ${format(parseISO(date), 'EEE, MMM d yyyy')} · ${storeName}`}>
      <div className="space-y-3">
        {edits.map((e) => (
          <div key={e.id} className="rounded-lg border border-brand-100 p-3 text-sm">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-medium text-gray-800">{ACTION_LABEL[e.action] ?? e.action}</span>
              <span className="text-xs text-gray-400">{new Date(e.edited_at).toLocaleString()}</span>
            </div>
            {e.action !== 'add' && e.before_occurred_at && (
              <p className="text-gray-600">
                Before: {TYPE_LABEL[e.before_event_type] ?? e.before_event_type} at{' '}
                {format(new Date(e.before_occurred_at), 'h:mm a')}
              </p>
            )}
            {e.action !== 'delete' && e.after_occurred_at && (
              <p className="text-gray-600">
                After: {TYPE_LABEL[e.after_event_type] ?? e.after_event_type} at{' '}
                {format(new Date(e.after_occurred_at), 'h:mm a')}
              </p>
            )}
            <p className="mt-1.5 text-gray-500">
              By {e.edited_by_name} — &ldquo;{e.note}&rdquo;
            </p>
          </div>
        ))}
      </div>
    </Modal>
  )
}
