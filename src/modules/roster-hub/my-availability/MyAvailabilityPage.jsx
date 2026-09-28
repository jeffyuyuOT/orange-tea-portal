import { useEffect, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import { thisWeekStart, nextWeekStart } from '../shared/rosterWeeks'
import {
  AVAILABILITY_MODES,
  QUARTER_HOUR_TIMES,
  formatQuarterHour,
  minutesToLabel,
  weekDatesFrom,
  loadWeekAvailability,
  saveWeekAvailability,
  findLeaveConflicts,
  rowToEditDay,
  editDayToRowShape,
} from '../../../lib/availability'

// Jeff, 2026-09: "在roster hub新增my availability...裡面像my roster一樣顯示
// this week...跟next week...兩個區塊" — same This Week / Next Week shape as
// My Roster, but each section is its own self-contained editor (own load,
// own Copy-last-week, own Save) rather than one shared form, since a save on
// one week has no bearing on the other.
export default function MyAvailabilityPage() {
  const { profile } = useAuth()

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">My Availability</h1>
      <p className="mb-4 text-sm text-gray-500">
        Let your manager know which hours you're available to work each day. Leave a day untouched and it stays
        "All day — Available" — you only need to change the days that are actually different.
      </p>

      <div className="space-y-8">
        <AvailabilityWeekSection title="This Week" weekStart={thisWeekStart()} profileId={profile?.id} />
        <AvailabilityWeekSection title="Next Week" weekStart={nextWeekStart()} profileId={profile?.id} />
      </div>
    </div>
  )
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function AvailabilityWeekSection({ title, weekStart, profileId }) {
  const dates = weekDatesFrom(weekStart)
  const [editState, setEditState] = useState(null) // null while loading; then { 'yyyy-MM-dd': {mode, boundaryTime, windows} }
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  // Set by Save when findLeaveConflicts finds an overlap — blocks the write
  // until the person edits their availability (or their leave) and retries,
  // per Jeff: "有衝突的話提交時會跳出警示窗...重疊" (a warning window on
  // submit, naming which slot overlaps which leave).
  const [conflicts, setConflicts] = useState(null)

  useEffect(() => {
    let cancelled = false
    setEditState(null)
    setMessage('')
    if (!profileId) return
    loadWeekAvailability(profileId, weekStart).then((byDate) => {
      if (cancelled) return
      const next = {}
      dates.forEach((d) => {
        next[d] = rowToEditDay(byDate[d])
      })
      setEditState(next)
    })
    return () => {
      cancelled = true
    }
    // dates is derived fresh from weekStart every render — only weekStart/profileId should re-trigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, weekStart])

  function updateDay(dateStr, patch) {
    setEditState((prev) => ({ ...prev, [dateStr]: { ...prev[dateStr], ...patch } }))
  }

  async function copyLastWeek() {
    const priorWeekStart = format(addDays(parseISO(weekStart), -7), 'yyyy-MM-dd')
    const priorDates = weekDatesFrom(priorWeekStart)
    const byDate = await loadWeekAvailability(profileId, priorWeekStart)
    const next = {}
    dates.forEach((d, i) => {
      next[d] = rowToEditDay(byDate[priorDates[i]])
    })
    setEditState(next)
    setMessage("Copied last week's availability below — Save to keep it.")
  }

  async function save() {
    setSaving(true)
    setMessage('')
    setConflicts(null)
    const { data: leaves, error: leaveError } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('profile_id', profileId)
      .eq('status', 'active')
    if (leaveError) {
      setSaving(false)
      setMessage(`Error: ${leaveError.message}`)
      return
    }
    const byDateForCheck = Object.fromEntries(dates.map((d) => [d, editDayToRowShape(editState[d])]))
    const found = findLeaveConflicts(byDateForCheck, leaves ?? [])
    if (found.length) {
      setConflicts(found)
      setSaving(false)
      return
    }
    const { error } = await saveWeekAvailability(profileId, weekStart, editState)
    setSaving(false)
    setMessage(error ? `Error: ${error.message}` : 'Availability saved.')
  }

  const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">
          {title} <span className="font-normal text-gray-400">({format(parseISO(weekStart), 'd MMM')} – {format(parseISO(weekEnd), 'd MMM')})</span>
        </h3>
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={copyLastWeek} disabled={!editState}>
          Copy last week
        </Button>
      </div>

      {!editState ? (
        <LoadingSpinner />
      ) : (
        <div className="overflow-hidden rounded-xl border border-brand-100">
          <div className="divide-y divide-brand-50">
            {dates.map((dateStr, i) => (
              <DayEditor
                key={dateStr}
                label={`${DAY_LABELS[i]} ${format(parseISO(dateStr), 'd/M')}`}
                day={editState[dateStr]}
                onChange={(patch) => updateDay(dateStr, patch)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={!editState || saving}>
          {saving ? 'Saving…' : `Save ${title}`}
        </Button>
        {message && <p className="text-sm text-brand-600">{message}</p>}
      </div>

      <Modal
        open={!!conflicts}
        onClose={() => setConflicts(null)}
        title="Availability conflicts with your leave"
        footer={
          <Button variant="secondary" onClick={() => setConflicts(null)}>
            Close
          </Button>
        }
      >
        <p className="mb-3 text-sm text-gray-600">
          These available time slots overlap with leave you already have registered — adjust one or the other, then
          Save again.
        </p>
        <ul className="space-y-2 text-sm">
          {(conflicts ?? []).map((c, i) => (
            <li key={i} className="rounded-lg border border-red-100 bg-red-50 p-2.5 text-red-700">
              <div className="font-medium">{format(parseISO(c.dateStr), 'EEE d MMM')}</div>
              <div>
                Available {minutesToLabel(c.availWindow.start)} – {minutesToLabel(c.availWindow.end)} overlaps leave{' '}
                {minutesToLabel(c.leaveWindow.start)} – {minutesToLabel(c.leaveWindow.end)}
                {c.leave.reason ? ` (${c.leave.reason})` : ''}
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  )
}

// One day's row: the day label, its mode select, and whatever that mode
// needs — nothing (all_available/all_unavailable), a single boundary time
// (before/after), or an editable list of specific windows (custom).
function DayEditor({ label, day, onChange }) {
  function updateWindow(idx, patch) {
    onChange({ windows: day.windows.map((w, i) => (i === idx ? { ...w, ...patch } : w)) })
  }
  function addWindow() {
    onChange({ windows: [...(day.windows ?? []), { start: '09:00', end: '17:00' }] })
  }
  function removeWindow(idx) {
    onChange({ windows: day.windows.filter((_, i) => i !== idx) })
  }

  return (
    <div className="flex flex-wrap items-start gap-3 px-3 py-2.5">
      <div className="w-20 shrink-0 pt-1.5 text-sm font-medium text-gray-700">{label}</div>

      <select
        className="input !w-52 !py-1.5"
        value={day.mode}
        onChange={(e) => onChange({ mode: e.target.value, boundaryTime: '', windows: e.target.value === 'custom' ? day.windows?.length ? day.windows : [{ start: '09:00', end: '17:00' }] : day.windows })}
      >
        {AVAILABILITY_MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      {(day.mode === 'before' || day.mode === 'after') && (
        <select className="input !w-40 !py-1.5" value={day.boundaryTime} onChange={(e) => onChange({ boundaryTime: e.target.value })}>
          <option value="" disabled>
            Select time…
          </option>
          {QUARTER_HOUR_TIMES.map((t) => (
            <option key={t} value={t}>
              {formatQuarterHour(t)}
            </option>
          ))}
        </select>
      )}

      {day.mode === 'custom' && (
        <div className="flex flex-1 flex-col gap-1.5">
          {(day.windows ?? []).map((w, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select className="input !w-36 !py-1.5" value={w.start} onChange={(e) => updateWindow(i, { start: e.target.value })}>
                {QUARTER_HOUR_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {formatQuarterHour(t)}
                  </option>
                ))}
              </select>
              <span className="text-gray-400">–</span>
              <select className="input !w-36 !py-1.5" value={w.end} onChange={(e) => updateWindow(i, { end: e.target.value })}>
                {QUARTER_HOUR_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {formatQuarterHour(t)}
                  </option>
                ))}
              </select>
              <button type="button" className="px-1.5 text-gray-400 hover:text-red-500" onClick={() => removeWindow(i)} aria-label="Remove time range">
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="self-start text-xs font-medium text-brand-600 hover:text-brand-700" onClick={addWindow}>
            + Add time range
          </button>
        </div>
      )}
    </div>
  )
}
