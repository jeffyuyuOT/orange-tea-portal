import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { addAttendanceEvent, updateAttendanceEvent, deleteAttendanceEvent, combineDateAndTime } from '../../../lib/attendance'

let nextLocalKey = 0
function localKey() {
  nextLocalKey += 1
  return `new-${nextLocalKey}`
}

// Jeff, 2026-09: "以防有員工忘記log in and out回報需要更改或新增log in and
// out時間" — admin, or a shop_manager with the new Edit attendance logs
// permission, can fix an existing punch's time, remove a mis-scanned one,
// or add one that was simply never made, always with a required reason.
//
// Two ways in, both from AttendanceLogTable:
// - Click "Edit" on an existing cell — `storeId`/`date`/`punches` are all
//   already known and fixed (not editable here); this only lets you touch
//   punches within that one cell.
// - Click "+ Add record" — `storeId`/`date` start empty and `storeOptions`
//   is offered as a <select>/date picker instead, `punches` starts empty.
export default function AttendanceCellEditModal({ storeId, date, storeOptions, punches, profileId, editor, onClose, onSaved }) {
  const isNewCell = !storeId || !date
  const [pickedStoreId, setPickedStoreId] = useState(storeId ?? '')
  const [pickedDate, setPickedDate] = useState(date ?? format(new Date(), 'yyyy-MM-dd'))
  const [rows, setRows] = useState(() =>
    [...punches]
      .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
      .map((p) => ({
        key: p.id,
        existing: true,
        deleted: false,
        eventType: p.event_type,
        time: format(new Date(p.occurred_at), 'HH:mm'),
        _orig: p,
      }))
  )
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function addRow() {
    const lastType = [...rows].reverse().find((r) => !r.deleted)?.eventType
    setRows((prev) => [...prev, { key: localKey(), existing: false, deleted: false, eventType: lastType === 'clock_in' ? 'clock_out' : 'clock_in', time: '' }])
  }

  function updateRow(key, patch) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function toggleDeleted(key) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, deleted: !r.deleted } : r)))
  }

  function removeNewRow(key) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  async function save() {
    setError('')
    if (!pickedStoreId || !pickedDate) {
      setError('Please choose a store and date.')
      return
    }
    if (!note.trim()) {
      setError('Please explain why you’re making this change.')
      return
    }
    const changed = rows.some(
      (r) =>
        (r.existing && r.deleted) ||
        (r.existing && !r.deleted && (r.time !== format(new Date(r._orig.occurred_at), 'HH:mm') || r.eventType !== r._orig.event_type)) ||
        (!r.existing && r.time)
    )
    if (!changed) {
      setError('No changes to save.')
      return
    }

    setSaving(true)
    for (const r of rows) {
      if (r.existing && r.deleted) {
        const { error: err } = await deleteAttendanceEvent({ event: r._orig, note: note.trim(), editor })
        if (err) {
          setError(err.message ?? 'Something went wrong saving that change.')
          setSaving(false)
          return
        }
      } else if (r.existing && !r.deleted) {
        const origTime = format(new Date(r._orig.occurred_at), 'HH:mm')
        if (r.time !== origTime || r.eventType !== r._orig.event_type) {
          if (!r.time) continue // blanked out without deleting — ignore rather than write garbage
          const { error: err } = await updateAttendanceEvent({
            event: r._orig,
            eventType: r.eventType,
            occurredAt: combineDateAndTime(pickedDate, r.time),
            note: note.trim(),
            editor,
          })
          if (err) {
            setError(err.message ?? 'Something went wrong saving that change.')
            setSaving(false)
            return
          }
        }
      } else if (!r.existing && r.time) {
        const { error: err } = await addAttendanceEvent({
          profileId,
          storeId: pickedStoreId,
          eventType: r.eventType,
          occurredAt: combineDateAndTime(pickedDate, r.time),
          note: note.trim(),
          editor,
        })
        if (err) {
          setError(err.message ?? 'Something went wrong saving that change.')
          setSaving(false)
          return
        }
      }
    }
    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNewCell ? 'Add attendance record' : `Edit — ${format(parseISO(date), 'EEE, MMM d yyyy')}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {isNewCell && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Store</span>
            <select className="input" value={pickedStoreId} onChange={(e) => setPickedStoreId(e.target.value)}>
              <option value="">— Choose —</option>
              {storeOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Date</span>
            <input type="date" className="input" value={pickedDate} onChange={(e) => setPickedDate(e.target.value)} />
          </label>
        </div>
      )}

      <div className="mb-3 space-y-2">
        {rows.map((r) => (
          <div key={r.key} className={`flex items-center gap-2 ${r.deleted ? 'opacity-40' : ''}`}>
            <select
              className="input w-auto"
              value={r.eventType}
              disabled={r.deleted}
              onChange={(e) => updateRow(r.key, { eventType: e.target.value })}
            >
              <option value="clock_in">Clock in</option>
              <option value="clock_out">Clock out</option>
            </select>
            <input
              type="time"
              className="input w-auto"
              value={r.time}
              disabled={r.deleted}
              onChange={(e) => updateRow(r.key, { time: e.target.value })}
            />
            {r.existing ? (
              <button
                type="button"
                onClick={() => toggleDeleted(r.key)}
                className="text-xs font-medium text-red-500 hover:underline"
              >
                {r.deleted ? 'Undo remove' : 'Remove'}
              </button>
            ) : (
              <button type="button" onClick={() => removeNewRow(r.key)} className="text-xs font-medium text-gray-400 hover:underline">
                Discard
              </button>
            )}
          </div>
        ))}
        {!rows.length && <p className="text-sm text-gray-400">No punches yet — add one below.</p>}
      </div>

      <button type="button" onClick={addRow} className="mb-4 text-sm font-medium text-brand-600 hover:underline">
        + Add a clock in/out time
      </button>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Reason for this change (required)</span>
        <textarea
          className="input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Forgot to clock out at end of shift — confirmed with staff member"
        />
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
