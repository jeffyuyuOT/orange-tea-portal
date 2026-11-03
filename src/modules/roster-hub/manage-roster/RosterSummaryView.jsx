import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName } from '../../../lib/excelRoster'
import {
  availableWindowsWithLeave,
  describeDayWithLeave,
  leaveWindowOnDate,
  minutesToLabel,
  shiftConflictsWithAvailability,
  shiftConflictsWithLeave,
} from '../../../lib/availability'
import { HourInput } from './RosterEntryGrid'

// Jeff, 2026-11-02: "Summary" page — the Manage Roster grid flipped around so
// each day only lists the people actually working it (no all-staff name
// column down the left), one cell per shift showing name + time.
//   - click a NAME  -> pick someone else for that shift. Everyone is listed
//     with that day's availability (leave already reconciled), ranked: fully
//     available first (all-day available at the very top), then partly
//     available (more of the shift covered = higher), then unavailable,
//     colour-coded; anyone already working that day goes last, disabled.
//   - click a TIME  -> edit start/end, then the same soft availability/leave
//     check the Input page does on blur (a heads-up only, never blocks).
// It edits the SAME `entries` array the Input page uses, so nothing is saved
// until Save/Submit on the page toolbar, exactly like typing into the grid.

// Same ceiling as ManageRosterPage's findInvalidTimeEntries (30 = 6am the
// next day) so a value accepted here can never be rejected at Save/Submit.
const MAX_SHIFT_HOUR = 30

function weekdayLabel(dateStr) {
  return format(parseISO(dateStr), 'EEE')
}

function hasShift(e) {
  return (
    e.startTime !== '' &&
    e.startTime != null &&
    e.endTime !== '' &&
    e.endTime != null &&
    Number.isFinite(Number(e.startTime)) &&
    Number.isFinite(Number(e.endTime))
  )
}

// decimal hours -> "9:00 AM". % 1440 so a 24 (midnight) end reads 12:00 AM
// rather than minutesToLabel's clamp doing something surprising on >24.
function hourLabel(h) {
  return minutesToLabel(Math.round(Number(h) * 60) % 1440)
}

// Same identity rule RosterEntryGrid's `matches` uses (profileId when there
// is one, otherwise the typed/imported name), plus the date.
function sameEntry(e, t) {
  if (e.date !== t.date) return false
  return t.profileId ? e.profileId === t.profileId : e.staffName === t.staffName
}

function leavesOnDate(leavesByProfile, profileId, dateStr) {
  return (leavesByProfile?.[profileId] ?? []).map((l) => leaveWindowOnDate(l, dateStr)).filter(Boolean)
}

// Same "first profile missing == still loading" rule StaffAvailabilityModal
// uses — otherwise a still-loading week would read as everyone available.
function availabilityLoading(staff, availabilityByProfile) {
  return staff.length > 0 && !availabilityByProfile?.[staff[0].id]
}

// Same order RosterEntryGrid.checkConflict applies: leave wins, then the
// declared availability. null = no conflict (or nothing to compare against).
function findConflict(profileId, date, start, end, availabilityByProfile, leavesByProfile) {
  if (!profileId) return null
  if (shiftConflictsWithLeave(start, end, leavesOnDate(leavesByProfile, profileId, date))) return 'leave'
  const avail = availabilityByProfile?.[profileId]?.[date]
  if (!avail) return null
  return shiftConflictsWithAvailability(start, end, avail.dayRow, avail.windows) ? 'availability' : null
}

function mergeWindows(windows) {
  const sorted = [...windows].sort((a, b) => a.start - b.start)
  const out = []
  for (const w of sorted) {
    const last = out[out.length - 1]
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end)
    else out.push({ start: w.start, end: w.end })
  }
  return out
}

// Everyone on `staff` except whoever currently holds the shift, annotated
// and sorted for the "who else could take this shift" picker.
function rankCandidates({ staff, target, entries, availabilityByProfile, leavesByProfile }) {
  const shiftStart = Math.round(Number(target.startTime) * 60)
  const shiftEnd = Math.round(Number(target.endTime) * 60)
  const shiftLen = shiftEnd - shiftStart
  const rank = { full: 0, partial: 1, none: 2 }

  return staff
    .filter((p) => p.id !== target.profileId)
    .map((p) => {
      const avail = availabilityByProfile?.[p.id]?.[target.date]
      const leaveWindows = leavesOnDate(leavesByProfile, p.id, target.date)
      const windows = mergeWindows(availableWindowsWithLeave(avail?.dayRow, avail?.windows, leaveWindows))
      const totalAvail = windows.reduce((sum, w) => sum + (w.end - w.start), 0)
      const covered = windows.reduce(
        (sum, w) => sum + Math.max(0, Math.min(w.end, shiftEnd) - Math.max(w.start, shiftStart)),
        0
      )
      let status = 'none'
      if (shiftLen <= 0 || covered >= shiftLen) status = 'full'
      else if (covered > 0) status = 'partial'
      const desc = describeDayWithLeave(avail?.dayRow, avail?.windows, leaveWindows)
      const alreadyWorking = entries.some((e) => e.profileId === p.id && e.date === target.date && hasShift(e))
      return { profile: p, status, desc, covered, totalAvail, alreadyWorking }
    })
    .sort((a, b) => {
      if (a.alreadyWorking !== b.alreadyWorking) return a.alreadyWorking ? 1 : -1
      if (a.status !== b.status) return rank[a.status] - rank[b.status]
      // Fully available: all-day-available (most minutes available) first.
      // Partial: more of THIS shift covered first, then more available overall.
      if (a.status === 'partial' && a.covered !== b.covered) return b.covered - a.covered
      if (a.totalAvail !== b.totalAvail) return b.totalAvail - a.totalAvail
      return rosterDisplayName(a.profile).localeCompare(rosterDisplayName(b.profile))
    })
}

const CANDIDATE_STYLE = {
  full: 'border-emerald-200 bg-white hover:bg-emerald-50',
  partial: 'border-amber-300 bg-amber-50 hover:bg-amber-100',
  none: 'border-rose-200 bg-rose-50 hover:bg-rose-100',
}
const CANDIDATE_DESC_STYLE = {
  full: 'text-emerald-700',
  partial: 'text-amber-700',
  none: 'text-rose-600',
}

function candidateDescription(c) {
  if (c.alreadyWorking) return 'Already scheduled this day'
  if (c.status === 'none') {
    return c.desc === 'Unavailable' ? 'Unavailable' : `Unavailable at this time — available: ${c.desc}`
  }
  if (c.status === 'partial') return `Only partly available — ${c.desc}`
  return c.desc
}

function ReplaceStaffModal({ target, staff, entries, availabilityByProfile, leavesByProfile, onClose, onPick }) {
  const loading = availabilityLoading(staff, availabilityByProfile)
  const candidates = loading ? [] : rankCandidates({ staff, target, entries, availabilityByProfile, leavesByProfile })

  return (
    <Modal
      open
      onClose={onClose}
      title={`Replace ${target.staffName}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <p className="mb-3 text-sm text-gray-600">
        {format(parseISO(target.date), 'EEE d MMM')}, {hourLabel(target.startTime)} – {hourLabel(target.endTime)}. Pick who
        works this shift instead — the shift's time and break stay as they are.
      </p>
      {loading ? (
        <LoadingSpinner />
      ) : !candidates.length ? (
        <p className="text-sm text-gray-400">No other staff on this roster.</p>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((c) => (
            <button
              key={c.profile.id}
              type="button"
              disabled={c.alreadyWorking}
              onClick={() => onPick(c.profile)}
              className={`block w-full rounded-lg border px-3 py-2 text-left disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:opacity-60 ${
                CANDIDATE_STYLE[c.status]
              }`}
            >
              <div className="text-sm font-semibold text-gray-800">{rosterDisplayName(c.profile)}</div>
              <div className={`text-xs ${c.alreadyWorking ? 'text-gray-400' : CANDIDATE_DESC_STYLE[c.status]}`}>
                {candidateDescription(c)}
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

function EditTimeModal({ target, timeInputFormat, availabilityByProfile, leavesByProfile, onClose, onSave }) {
  // Canonical decimal hours (10.5 = 10:30); HourInput does the parsing for
  // whichever Time format (Decimal / Compact) the page is set to. '' = blank,
  // NaN = something typed that isn't a time in that format.
  const [start, setStart] = useState(target.startTime)
  const [end, setEnd] = useState(target.endTime)
  // Jeff, 2026-11-03: Break is edited here too — same unit as the grid's
  // Break (½h) row (half-hour units: 1 = 30 min, 2 = 1 hr), always plain
  // decimal typing (never the Compact time format — it isn't a clock time).
  // '' = no break.
  const [brk, setBrk] = useState(target.breakHours ?? '')

  const startNum = Number(start)
  const endNum = Number(end)
  const brkEmpty = brk === '' || brk == null
  let error = ''
  if (start === '' || end === '') error = 'Enter both a start and an end time.'
  else if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) {
    error =
      timeInputFormat === 'compact'
        ? 'Times need to look like 930 or 1030 (hour then minutes).'
        : 'Times need to be hours, like 9 or 10.5 (= 10:30).'
  } else if (startNum < 0 || endNum > MAX_SHIFT_HOUR || startNum > MAX_SHIFT_HOUR) error = 'That time is out of range.'
  else if (endNum <= startNum) error = 'End time has to be after the start time.'
  else if (!brkEmpty && (!Number.isFinite(Number(brk)) || Number(brk) < 0)) {
    error = 'Break needs to be a number of half-hours (1 = 30 min, 2 = 1 hr), or left blank.'
  }

  const avail = target.profileId ? availabilityByProfile?.[target.profileId]?.[target.date] : null
  const availText = avail
    ? describeDayWithLeave(avail.dayRow, avail.windows, leavesOnDate(leavesByProfile, target.profileId, target.date))
    : ''

  return (
    <Modal
      open
      onClose={onClose}
      title={`${target.staffName} — ${format(parseISO(target.date), 'EEE d MMM')}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!error} onClick={() => onSave(startNum, endNum, brkEmpty ? '' : Number(brk))}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Start</span>
          <HourInput value={start} onChange={setStart} format={timeInputFormat} className="!w-24 !py-1.5 !text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">End</span>
          <HourInput value={end} onChange={setEnd} format={timeInputFormat} className="!w-24 !py-1.5 !text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-red-500">Break (½h)</span>
          <HourInput
            value={brk}
            onChange={setBrk}
            className="!w-20 !py-1.5 !text-sm text-red-600"
            title="Half-hour units — 1 = 30 min, 2 = 1 hr"
          />
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">Break is in half-hour units — 1 = 30 min, 2 = 1 hr. Leave blank for no break.</p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {availText && (
        <p className="mt-3 text-xs text-gray-500">
          Declared availability that day: <span className="font-medium text-gray-700">{availText}</span>
        </p>
      )}
    </Modal>
  )
}

function ShiftCell({ entry, onReplace, onEditTime }) {
  return (
    // Jeff, 2026-11-02: on a phone the name and time used to be stacked, so
    // the two tap targets sat right on top of each other and it was easy to
    // hit the wrong one. Below `sm` they now share one row — name on the
    // left, time after it on the right, with a gap between and taller tap
    // areas — while the 7-column desktop layout keeps the stacked cell.
    <div className="flex items-center justify-between gap-4 rounded-lg border border-brand-100 bg-white px-2 py-0.5 sm:block sm:px-2 sm:py-1">
      <button
        type="button"
        onClick={() => onReplace(entry)}
        className="block min-w-0 flex-1 truncate py-2 text-left text-sm font-semibold text-gray-800 underline decoration-dotted decoration-gray-300 underline-offset-2 hover:text-brand-700 hover:decoration-brand-500 sm:w-full sm:flex-none sm:py-0 sm:text-sm"
        title="Click to swap in someone else for this shift"
      >
        {entry.staffName || 'Unnamed'}
      </button>
      <button
        type="button"
        onClick={() => onEditTime(entry)}
        className="block shrink-0 whitespace-nowrap py-2 pl-2 text-right text-sm text-brand-700 hover:underline sm:mt-0.5 sm:w-full sm:whitespace-normal sm:py-0 sm:pl-0 sm:text-left sm:text-[13px]"
        title="Click to change this shift's time and break"
      >
        {hourLabel(entry.startTime)} – {hourLabel(entry.endTime)}
        {/* Jeff, 2026-11-03: how many break units (½h each) this shift has,
            right after the time — hidden when there's no break. Kept to a
            short "B×1" in its own small red tag (set apart from the time by
            the tag's background and gap) so the Summary stays easy to scan;
            the edit popup still says "Break (½h)" in full. */}
        {Number(entry.breakHours) > 0 && (
          <span
            className="ml-2.5 inline-block whitespace-nowrap rounded bg-red-50 px-1.5 py-px text-[11px] font-semibold text-red-500"
            title={`Break ×${Number(entry.breakHours)} (half-hour units — 1 = 30 min, 2 = 1 hr)`}
          >
            B×{Number(entry.breakHours)}
          </span>
        )}
      </button>
    </div>
  )
}

export default function RosterSummaryView({
  staff,
  weekDates,
  entries,
  setEntries,
  availabilityByProfile,
  leavesByProfile,
  mobileDayIdx,
  setMobileDayIdx,
  timeInputFormat = 'decimal',
}) {
  const [replacing, setReplacing] = useState(null)
  const [editing, setEditing] = useState(null)
  const [conflictWarning, setConflictWarning] = useState(null)

  // Everyone working `date`, earliest start first.
  function shiftsOn(date) {
    return entries
      .filter((e) => e.date === date && hasShift(e))
      .sort(
        (a, b) =>
          Number(a.startTime) - Number(b.startTime) ||
          Number(a.endTime) - Number(b.endTime) ||
          String(a.staffName).localeCompare(String(b.staffName))
      )
  }

  function pickReplacement(profile) {
    const target = replacing
    setReplacing(null)
    if (!target) return
    setEntries((prev) => {
      // Drop any empty leftover entry the new person has that day (a blank
      // placeholder), so they end up with exactly one entry for it.
      const rest = prev.filter((e) => !(e.profileId === profile.id && e.date === target.date && !hasShift(e)))
      return rest.map((e) => (sameEntry(e, target) ? { ...e, profileId: profile.id, staffName: rosterDisplayName(profile) } : e))
    })
  }

  function applyTime(target, start, end, breakHours) {
    setEntries((prev) =>
      prev.map((e) => (sameEntry(e, target) ? { ...e, startTime: start, endTime: end, breakHours } : e))
    )
  }

  // Jeff, 2026-11-02: the availability/leave check used to run AFTER the new
  // time was already applied, so closing the warning still left the changed
  // time in place. Now the check runs first: a conflict holds the change in
  // `conflictWarning` (nothing applied yet) until "Save anyway"; "No save" /
  // closing the popup just drops it, so the original time stays.
  function saveTime(start, end, breakHours) {
    const target = editing
    setEditing(null)
    if (!target) return
    // Only a changed shift time is checked against availability/leave — if
    // just the break was edited, the shift itself is exactly as before.
    const timeChanged = Number(target.startTime) !== start || Number(target.endTime) !== end
    const type = timeChanged
      ? findConflict(target.profileId, target.date, start, end, availabilityByProfile, leavesByProfile)
      : null
    if (type) {
      setConflictWarning({ type, target, name: target.staffName, date: target.date, start, end, breakHours })
      return
    }
    applyTime(target, start, end, breakHours)
  }

  const mobileDate = weekDates[Math.min(mobileDayIdx, weekDates.length - 1)]

  return (
    <div className="rounded-xl border border-brand-100">
      <div className="border-b border-brand-100 bg-brand-50 px-3 py-2 text-xs text-gray-500">
        Summary of this week's shifts. Click a name to swap in someone else, or a time to change it — changes aren't saved
        until you Save / Submit.
      </div>

      {/* Desktop: one column per day, only the people working that day. */}
      <div className="hidden grid-cols-7 sm:grid">
        {weekDates.map((d) => {
          const shifts = shiftsOn(d)
          return (
            <div key={d} className="min-w-0 border-r border-brand-100 last:border-r-0">
              <div className="border-b border-brand-100 bg-brand-50 px-1.5 py-1 text-center text-xs font-medium text-brand-700">
                {weekdayLabel(d)} {d.slice(5)}
              </div>
              <div className="space-y-1.5 p-1.5">
                {shifts.length ? (
                  shifts.map((e) => (
                    <ShiftCell key={`${e.profileId || e.staffName}:${e.date}`} entry={e} onReplace={setReplacing} onEditTime={setEditing} />
                  ))
                ) : (
                  <div className="py-2 text-center text-xs text-gray-300">No shifts</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Mobile: day tabs, then that day's shifts (same tabs as the Input page). */}
      <div className="sm:hidden">
        <div className="sticky top-0 z-10 flex border-b border-brand-100 bg-white">
          {weekDates.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => setMobileDayIdx(i)}
              className={`flex flex-1 flex-col items-center gap-0.5 border-b-2 py-2 text-xs font-medium ${
                i === mobileDayIdx ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-transparent text-gray-400'
              }`}
            >
              <span>{weekdayLabel(d)}</span>
              <span>{d.slice(8)}</span>
            </button>
          ))}
        </div>
        <div className="space-y-1.5 p-2">
          {mobileDate && shiftsOn(mobileDate).length ? (
            shiftsOn(mobileDate).map((e) => (
              <ShiftCell key={`${e.profileId || e.staffName}:${e.date}`} entry={e} onReplace={setReplacing} onEditTime={setEditing} />
            ))
          ) : (
            <div className="py-4 text-center text-sm text-gray-300">No shifts</div>
          )}
        </div>
      </div>

      {replacing && (
        <ReplaceStaffModal
          target={replacing}
          staff={staff}
          entries={entries}
          availabilityByProfile={availabilityByProfile}
          leavesByProfile={leavesByProfile}
          onClose={() => setReplacing(null)}
          onPick={pickReplacement}
        />
      )}

      {editing && (
        <EditTimeModal
          key={`${editing.profileId || editing.staffName}:${editing.date}`}
          target={editing}
          timeInputFormat={timeInputFormat}
          availabilityByProfile={availabilityByProfile}
          leavesByProfile={leavesByProfile}
          onClose={() => setEditing(null)}
          onSave={saveTime}
        />
      )}

      <Modal
        open={!!conflictWarning}
        onClose={() => setConflictWarning(null)}
        title={conflictWarning?.type === 'leave' ? 'Scheduled during approved leave' : 'Outside declared availability'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflictWarning(null)}>
              No save
            </Button>
            <Button
              onClick={() => {
                const w = conflictWarning
                setConflictWarning(null)
                if (w) applyTime(w.target, w.start, w.end, w.breakHours)
              }}
            >
              Save anyway
            </Button>
          </>
        }
      >
        {conflictWarning && (
          <p className={`text-sm ${conflictWarning.type === 'leave' ? 'text-red-600' : 'text-gray-600'}`}>
            {conflictWarning.name}'s shift on {format(parseISO(conflictWarning.date), 'EEE d MMM')} (
            {hourLabel(conflictWarning.start)} – {hourLabel(conflictWarning.end)}){' '}
            {conflictWarning.type === 'leave' ? (
              <>
                falls during leave they have approved for that day. Choose Save anyway to change the time regardless
                (in case the leave was since cancelled but hasn't been updated here yet), or No save to keep the
                original time.
              </>
            ) : (
              <>
                falls outside the availability they declared for that day. Choose Save anyway to change the time
                regardless (in case their availability changed but hasn't been updated here yet), or No save to keep
                the original time.
              </>
            )}
          </p>
        )}
      </Modal>
    </div>
  )
}
