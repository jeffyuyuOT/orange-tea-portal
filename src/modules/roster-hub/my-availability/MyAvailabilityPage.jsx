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
  minutesToLabel,
  weekDatesFrom,
  loadWeekAvailability,
  saveWeekAvailability,
  findLeaveConflicts,
  rowToEditDay,
  editDayToRowShape,
} from '../../../lib/availability'
import TimeOfDaySelect from './TimeOfDaySelect'

// Jeff, 2026-09: "在roster hub新增my availability...裡面像my roster一樣顯示
// this week...跟next week...兩個區塊" — same This Week / Next Week shape as
// My Roster, but each section is its own self-contained editor (own load,
// own Copy-last-week, own Save) rather than one shared form, since a save on
// one week has no bearing on the other.
export default function MyAvailabilityPage() {
  const { profile, refreshProfile } = useAuth()
  // Jeff, 2026-10-02: "my available time的copy last week左邊新增lock time
  // pattern。勾取的話，就會自動將目前的time pattern帶到下個禮拜，而且勾取此
  // 選項的user不會收到系統提示" — profile-level (not tied to either week
  // section specifically), so it's lifted up here and passed to both
  // sections below rather than each keeping its own copy that could get
  // out of sync with the other. `locked` mirrors `profile.availability_
  // pattern_locked` (migration 0087) but as its own state so the checkbox
  // responds immediately on click rather than waiting on a full profile
  // refetch; `saving` just disables it mid-request so a second click can't
  // race the first. The actual weekly auto-copy + reminder-suppression
  // this flag drives happens server-side (migration 0088's pg_cron job) —
  // this page only sets the flag.
  const [locked, setLocked] = useState(false)
  const [savingLock, setSavingLock] = useState(false)

  useEffect(() => {
    setLocked(!!profile?.availability_pattern_locked)
  }, [profile?.availability_pattern_locked])

  async function toggleLocked(next) {
    setLocked(next)
    setSavingLock(true)
    await supabase.from('profiles').update({ availability_pattern_locked: next }).eq('id', profile.id)
    setSavingLock(false)
    refreshProfile()
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">My Availability</h1>
      <p className="mb-4 text-sm text-gray-500">
        Let your manager know which hours you're available to work each day. Leave a day untouched and it stays
        "All day — Available" — you only need to change the days that are actually different.
      </p>

      <div className="space-y-8">
        <AvailabilityWeekSection
          title="This Week"
          weekStart={thisWeekStart()}
          profileId={profile?.id}
          locked={locked}
          savingLock={savingLock}
          onToggleLocked={toggleLocked}
        />
        <AvailabilityWeekSection
          title="Next Week"
          weekStart={nextWeekStart()}
          profileId={profile?.id}
          locked={locked}
          savingLock={savingLock}
          onToggleLocked={toggleLocked}
        />
      </div>
    </div>
  )
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function AvailabilityWeekSection({ title, weekStart, profileId, locked, savingLock, onToggleLocked }) {
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
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              checked={locked}
              disabled={savingLock}
              onChange={(e) => onToggleLocked(e.target.checked)}
            />
            Lock time pattern
          </label>
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={copyLastWeek} disabled={!editState}>
            Copy last week
          </Button>
        </div>
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
        <TimeOfDaySelect value={day.boundaryTime || '09:00'} onChange={(t) => onChange({ boundaryTime: t })} />
      )}

      {day.mode === 'custom' && (
        <div className="flex flex-1 flex-col gap-1.5">
          {(day.windows ?? []).map((w, i) => (
            // Jeff, 2026-10-04: "手機版my availability填寫specific time的時候
            // 時間會卡在螢幕外面" — each TimeOfDaySelect is 3 fixed-width
            // selects (hour/minute/AM-PM) side by side, and a start+end pair
            // plus the "–" and remove button never fit in one line on a
            // phone — this whole row used to be a single non-wrapping flex
            // line, so the end-time picker just ran off the right edge of
            // the screen with no way to reach it. flex-wrap here, plus
            // grouping "– end-time ✕" into one nested flex item, lets that
            // whole group drop to its own line under the start time instead
            // of being clipped — the dash never ends up orphaned alone on a
            // line by itself. Desktop is unaffected since everything still
            // fits on one line there.
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <TimeOfDaySelect value={w.start} onChange={(t) => updateWindow(i, { start: t })} />
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">–</span>
                <TimeOfDaySelect value={w.end} onChange={(t) => updateWindow(i, { end: t })} />
                <button type="button" className="px-1.5 text-gray-400 hover:text-red-500" onClick={() => removeWindow(i)} aria-label="Remove time range">
                  ✕
                </button>
              </div>
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
