import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import TypedTimeInput from './TypedTimeInput'
import {
  addAttendanceEvent,
  updateAttendanceEvent,
  deleteAttendanceEvent,
  combineDateAndTime,
  breakMinutesFromHalfHours,
  upsertAttendanceDayBreak,
  getRosterShiftForDay,
  formatMinutes,
} from '../../../lib/attendance'

let nextLocalKey = 0
function localKey() {
  nextLocalKey += 1
  return `new-${nextLocalKey}`
}

// Jeff, 2026-09-30: "編輯時間時，reason改用下拉選單...選add reasons下面則
//可以手動輸入。如果是add reason到時候錯誤的訊息只選是手動輸入的內容" -- a
// preset dropdown instead of a free-text box for the common cases, with
// "add reasons" revealing a text box whose typed content becomes the ENTIRE
// saved reason (no label/prefix stuck in front of it) — that's why
// PRESET_LABELS' values are the exact final `note` text for the three
// fixed options: attendance_event_edits.note is always shown verbatim
// (AttendanceLogTable.jsx's inline "edit at … by …" note), so a preset's
// label IS its saved reason, and nothing extra needs to be stripped back
// out when displaying it later.
const REASON_PRESETS = [
  { value: 'forgot_in', label: 'Forgot to clock in at beginning of shift' },
  { value: 'forgot_out', label: 'Forgot to clock out at end of shift' },
  { value: 'forgot_in_out', label: 'Forgot to clock in/out at the shift' },
  { value: 'custom', label: 'Add reasons…' },
]
const PRESET_LABELS = Object.fromEntries(REASON_PRESETS.filter((p) => p.value !== 'custom').map((p) => [p.value, p.label]))

// Jeff, 2026-09: "以防有員工忘記log in and out回報需要更改或新增log in and
// out時間" — admin, or a shop_manager with the new Edit attendance logs
// permission, can fix an existing punch's time, remove a mis-scanned one,
// or add one that was simply never made, always with a required reason.
//
// Two ways in, both from AttendanceLogTable:
// - Click "Edit" on an existing cell — `storeId`/`date`/`punches` are all
//   already known and fixed (not editable here); this only lets you touch
//   punches (and the day's break — see ADD_MODES below) within that cell.
// - Click "+ Add record" — `storeId`/`date` start empty. Jeff, 2026-10-02:
//   "add attendance record時，不用選擇店面，因為上面其實已經有分頁切換代表
//   所屬分店" — no Store picker at all any more; a new record always
//   belongs to `currentStoreId` (whatever store the page itself is already
//   scoped to). "Date取代本來store的位置，原本的date位置改成下拉" — Date
//   takes the Store position, and an Add-via dropdown takes Date's old
//   position, picking HOW to fill the day in (see ADD_MODES).
const ADD_MODES = [
  { value: 'add', label: 'Add a clock in/out time' },
  { value: 'edit_break', label: 'Edit break' },
  { value: 'copy_roster', label: 'Copy roster' },
]

export default function AttendanceCellEditModal({
  storeId,
  date,
  currentStoreId,
  punches,
  initialBreakHalfHours,
  profileId,
  editor,
  onClose,
  onSaved,
}) {
  const isNewCell = !storeId || !date
  const effectiveStoreId = storeId ?? currentStoreId
  const [pickedDate, setPickedDate] = useState(date ?? format(new Date(), 'yyyy-MM-dd'))
  const [addMode, setAddMode] = useState('add') // only meaningful while isNewCell — see ADD_MODES
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
  // Break field: always editable on an existing cell (so a manager can fix
  // a forgotten break without re-touching punch times); on a new cell only
  // while addMode is 'edit_break' or 'copy_roster' — 'add' behaves exactly
  // like the original punches-only flow, per Jeff's "選add a clock in/out
  //則跟原來操作一樣".
  const showBreakField = !isNewCell || addMode === 'edit_break' || addMode === 'copy_roster'
  const showRows = isNewCell ? addMode !== 'edit_break' : true
  const [breakHalfHours, setBreakHalfHours] = useState(String(initialBreakHalfHours ?? 0))
  const [rosterNote, setRosterNote] = useState('')
  const [reasonPreset, setReasonPreset] = useState('')
  const [reasonCustom, setReasonCustom] = useState('')
  const note = reasonPreset === 'custom' ? reasonCustom.trim() : PRESET_LABELS[reasonPreset] ?? ''
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Jeff: "如果是選擇copy roster，則會直接將clock in/out的時間照班表帶入，
  // 並有幾次休息" — re-pulls whenever the mode is copy_roster and the
  // picked date changes, so switching the date re-fetches that day's shift
  // rather than leaving a stale previous day's times sitting in the rows.
  useEffect(() => {
    if (addMode !== 'copy_roster' || !effectiveStoreId || !pickedDate) return
    let cancelled = false
    setRosterNote('Loading roster…')
    getRosterShiftForDay(profileId, effectiveStoreId, pickedDate).then((shift) => {
      if (cancelled) return
      if (!shift) {
        setRosterNote('No published roster shift found for that day — nothing to copy.')
        return
      }
      setRows([
        { key: localKey(), existing: false, deleted: false, eventType: 'clock_in', time: shift.startTime },
        { key: localKey(), existing: false, deleted: false, eventType: 'clock_out', time: shift.endTime },
      ])
      setBreakHalfHours(String(shift.breakHalfHours))
      setRosterNote('')
    })
    return () => {
      cancelled = true
    }
  }, [addMode, effectiveStoreId, pickedDate, profileId])

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
    if (!effectiveStoreId || !pickedDate) {
      setError('Please choose a date.')
      return
    }
    if (!reasonPreset) {
      setError('Please select a reason for this change.')
      return
    }
    if (reasonPreset === 'custom' && !reasonCustom.trim()) {
      setError('Please describe the reason.')
      return
    }
    const breakNum = Number(breakHalfHours)
    if (showBreakField && (breakHalfHours === '' || !Number.isFinite(breakNum) || breakNum < 0)) {
      setError('Please enter a valid number of breaks (0 or more).')
      return
    }
    // Jeff, 2026-10-02: a new row left with no time typed in used to be
    // silently skipped at save time (the loop below only writes a new row
    // when `r.time` is truthy) — no error, Save just quietly did nothing
    // for it. Combined with editing away the cell's only other punch (e.g.
    // flipping its one clock_in to clock_out, meaning to replace it with
    // this new clock_in), that left the day with a single orphaned
    // clock_out and nothing else, which used to make the whole day vanish
    // from the table entirely (see attendance.js's pairEventsIntoSessions).
    // Now a half-filled new row blocks Save with a clear message instead of
    // silently discarding it — remove it with "Discard" if it wasn't meant
    // to be kept.
    if (showRows && rows.some((r) => !r.existing && !r.time)) {
      setError('Please enter a time for the new clock in/out row, or remove it.')
      return
    }
    const rowsChanged =
      showRows &&
      rows.some(
        (r) =>
          (r.existing && r.deleted) ||
          (r.existing && !r.deleted && (r.time !== format(new Date(r._orig.occurred_at), 'HH:mm') || r.eventType !== r._orig.event_type)) ||
          (!r.existing && r.time)
      )
    const breakChanged = showBreakField && breakNum !== Number(initialBreakHalfHours ?? 0)
    if (!rowsChanged && !breakChanged) {
      setError('No changes to save.')
      return
    }

    setSaving(true)
    if (showRows) {
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
            storeId: effectiveStoreId,
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
    }
    if (breakChanged) {
      const { error: err } = await upsertAttendanceDayBreak({
        profileId,
        storeId: effectiveStoreId,
        eventDate: pickedDate,
        breakHalfHours: breakNum,
        note: note.trim(),
        editor,
      })
      if (err) {
        setError(err.message ?? 'Something went wrong saving the break.')
        setSaving(false)
        return
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
            <span className="mb-1 block text-xs font-medium text-gray-500">Date</span>
            <input type="date" className="input" value={pickedDate} onChange={(e) => setPickedDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Add via</span>
            <select className="input" value={addMode} onChange={(e) => setAddMode(e.target.value)}>
              {ADD_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {rosterNote && <p className="mb-3 text-sm text-gray-500">{rosterNote}</p>}

      {showRows && (
        <>
          {/* Jeff, 2026-10-08: "clock in/out的欄寬縮短一點(可以fit字就好),
              後面的discard改用x表示，這樣am/pm的欄寬就可以寬一點" — the type
              select now uses !w-auto (plain w-auto was losing to .input's
              own width:100% — see TypedTimeInput.jsx's comment on the same
              cascade issue) so it only takes as much width as "Clock out"
              actually needs, and Remove/Discard collapse to a single ✕
              icon-button instead of a text label, freeing up room on this
              already-crowded mobile row for the AM/PM toggle to be
              comfortably tappable. "Undo remove" stays as text — it's a
              less-common, already-dimmed state where compactness matters
              less than being unambiguous about what tapping it undoes. */}
          <div className="mb-3 space-y-2">
            {rows.map((r) => (
              <div key={r.key} className={`flex flex-wrap items-center gap-2 ${r.deleted ? 'opacity-40' : ''}`}>
                <select
                  className="input !w-auto shrink-0"
                  value={r.eventType}
                  disabled={r.deleted}
                  onChange={(e) => updateRow(r.key, { eventType: e.target.value })}
                >
                  <option value="clock_in">Clock in</option>
                  <option value="clock_out">Clock out</option>
                </select>
                <TypedTimeInput value={r.time} disabled={r.deleted} onChange={(t) => updateRow(r.key, { time: t })} className="shrink-0" />
                {r.existing ? (
                  r.deleted ? (
                    <button
                      type="button"
                      onClick={() => toggleDeleted(r.key)}
                      className="shrink-0 text-xs font-medium text-red-500 hover:underline"
                    >
                      Undo remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleDeleted(r.key)}
                      title="Remove"
                      aria-label="Remove"
                      className="shrink-0 text-base leading-none text-red-500 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => removeNewRow(r.key)}
                    title="Discard"
                    aria-label="Discard"
                    className="shrink-0 text-base leading-none text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {!rows.length && <p className="text-sm text-gray-400">No punches yet — add one below.</p>}
          </div>

          <button type="button" onClick={addRow} className="mb-4 text-sm font-medium text-brand-600 hover:underline">
            + Add a clock in/out time
          </button>
        </>
      )}

      {showBreakField && (
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Break (30-min units — e.g. 2 = 1 hour)</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.5"
              className="input w-24"
              value={breakHalfHours}
              onChange={(e) => setBreakHalfHours(e.target.value)}
            />
            <span className="text-xs text-gray-400">
              {breakMinutesFromHalfHours(breakHalfHours) ? `−${formatMinutes(breakMinutesFromHalfHours(breakHalfHours))} off the total` : 'No break'}
            </span>
          </div>
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Reason for this change (required)</span>
        <select className="input" value={reasonPreset} onChange={(e) => setReasonPreset(e.target.value)}>
          <option value="">— Choose —</option>
          {REASON_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {reasonPreset === 'custom' && (
        <label className="mt-2 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Describe the reason</span>
          <textarea
            className="input"
            rows={2}
            value={reasonCustom}
            onChange={(e) => setReasonCustom(e.target.value)}
            placeholder="e.g. Confirmed with staff member — POS was down that afternoon"
          />
        </label>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
