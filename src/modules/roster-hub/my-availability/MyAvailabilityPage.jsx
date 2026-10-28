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
  loadWeekLocks,
  setWeekLock,
} from '../../../lib/availability'
import TimeOfDaySelect from './TimeOfDaySelect'

// Jeff, 2026-09: "在roster hub新增my availability...裡面像my roster一樣顯示
// this week...跟next week...兩個區塊" — same This Week / Next Week shape as
// My Roster, but each section is its own self-contained editor (own load,
// own Copy-last-week, own Save) rather than one shared form, since a save on
// one week has no bearing on the other.
export default function MyAvailabilityPage() {
  const { profile } = useAuth()
  const thisWeekStr = thisWeekStart()
  const nextWeekStr = nextWeekStart()
  // Jeff, 2026-10-28: "這禮拜跟下禮拜的lock time pattern可以各自勾取(不用同時
  // 勾取跟取消)" — migration 0087's single profile-level
  // `availability_pattern_locked` column forced This Week and Next Week to
  // always show (and toggle) the same value. Migration 0153 replaces it
  // with `availability_week_locks`, one existence-row per (profile, week),
  // so each week now carries its OWN lock state — loaded here as
  // { thisWeek, nextWeek } (null while loading) and passed down separately
  // to each section. Each section still needs to know the OTHER week's
  // lock too: "同時勾取lock time pattern時並save時兩邊才會同步" — saving
  // This Week only pushes a copy into Next Week when BOTH are checked at
  // once, not just This Week's own checkbox — so that decision has to be
  // made up here, where both states are visible together.
  const [locks, setLocks] = useState(null)
  const [savingLock, setSavingLock] = useState(false)
  // Jeff, 2026-10-24: "訊息說同步，但下禮拜六還是不一樣" / "禮拜天也不一樣" —
  // the This-Week-saved-while-locked sync (added just above, same day) WAS
  // writing next week's rows correctly, but the "Next Week" section is its
  // own independent component with its own load-on-mount effect, so it had
  // no way to know that This Week's save had just rewritten rows out from
  // under it — it kept showing whatever it had loaded when the page first
  // opened. Bumping this counter after a successful sync and passing it to
  // Next Week's effect as an extra dependency forces that section to
  // re-fetch from the database, so the screen catches up to what was
  // actually just saved instead of needing a manual page reload.
  const [nextWeekRefreshToken, setNextWeekRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!profile?.id) return
    loadWeekLocks(profile.id, [thisWeekStr, nextWeekStr]).then((lockedWeeks) => {
      if (cancelled) return
      setLocks({ thisWeek: lockedWeeks.has(thisWeekStr), nextWeek: lockedWeeks.has(nextWeekStr) })
    })
    return () => {
      cancelled = true
    }
  }, [profile?.id, thisWeekStr, nextWeekStr])

  async function toggleWeekLocked(weekStartStr, key, next) {
    setLocks((prev) => ({ ...prev, [key]: next }))
    setSavingLock(true)
    await setWeekLock(profile.id, weekStartStr, next)
    setSavingLock(false)
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
          weekStart={thisWeekStr}
          profileId={profile?.id}
          locked={!!locks?.thisWeek}
          otherWeekLocked={!!locks?.nextWeek}
          lockLoaded={!!locks}
          savingLock={savingLock}
          onToggleLocked={(next) => toggleWeekLocked(thisWeekStr, 'thisWeek', next)}
          isThisWeek
          onSyncedNextWeek={() => setNextWeekRefreshToken((t) => t + 1)}
        />
        <AvailabilityWeekSection
          title="Next Week"
          weekStart={nextWeekStr}
          profileId={profile?.id}
          locked={!!locks?.nextWeek}
          otherWeekLocked={!!locks?.thisWeek}
          lockLoaded={!!locks}
          savingLock={savingLock}
          onToggleLocked={(next) => toggleWeekLocked(nextWeekStr, 'nextWeek', next)}
          refreshToken={nextWeekRefreshToken}
        />
      </div>
    </div>
  )
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function AvailabilityWeekSection({
  title,
  weekStart,
  profileId,
  locked,
  otherWeekLocked,
  lockLoaded,
  savingLock,
  onToggleLocked,
  isThisWeek = false,
  onSyncedNextWeek,
  refreshToken = 0,
}) {
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
    // dates is derived fresh from weekStart every render — only weekStart/profileId (and, for
    // Next Week, a bump of refreshToken right after This Week's sync writes new rows for this
    // same week) should re-trigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, weekStart, refreshToken])

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
    if (error) {
      setSaving(false)
      setMessage(`Error: ${error.message}`)
      return
    }

    // Jeff, 2026-10-28: "同時勾取lock time pattern時並save時兩邊才會同步" —
    // now that each week carries its own independent lock (migration 0153),
    // saving This Week only pushes a copy into Next Week when BOTH weeks'
    // checkboxes are on at the same time — This Week being locked alone is
    // no longer enough, since Next Week might deliberately be left
    // unlocked with its own different pattern.
    if (!isThisWeek || !locked || !otherWeekLocked) {
      setSaving(false)
      setMessage('Availability saved.')
      return
    }

    // Jeff, 2026-10-24: "我lock time pattern,但這禮拜跟下禮拜的時間應該要同
    // 步? 禮拜天還是不一樣" — migration 0088's weekly cron only ever copies
    // THIS week's pattern into NEXT week once, early Monday morning
    // (Brisbane), and only into a next-week day that has no row at all yet
    // — so an edit to This Week made any time after that (exactly what
    // happened here: Sunday got flipped to Available after this week's own
    // Monday-morning copy had already run and already written next week's
    // Sunday as Unavailable) never reaches next week on its own — that
    // boundary has already passed and the cron never revisits it. Pushing
    // the save straight into next week right here, the moment This Week is
    // actually saved, is what actually keeps the two in sync the way "Lock
    // time pattern" implies, instead of relying entirely on Sunday night's
    // job. The cron is left exactly as-is — it's still what carries a
    // locked pattern forward for someone who never touches This Week again
    // after it's already been auto-copied once.
    const nextWeekStartStr = format(addDays(parseISO(weekStart), 7), 'yyyy-MM-dd')
    const nextDates = weekDatesFrom(nextWeekStartStr)
    const proposedNextByDate = {}
    dates.forEach((d, i) => {
      proposedNextByDate[nextDates[i]] = editState[d]
    })
    // Same leave-conflict check, re-run against next week's own calendar
    // dates — a day that would overlap leave already approved for NEXT week
    // keeps whatever next week already had (loaded fresh) instead of being
    // silently overwritten with This Week's pattern, the same "never
    // clobber a legitimate override" rule the cron job itself follows for
    // an already-populated day.
    const proposedNextForCheck = Object.fromEntries(nextDates.map((d) => [d, editDayToRowShape(proposedNextByDate[d])]))
    const nextConflicts = findLeaveConflicts(proposedNextForCheck, leaves ?? [])
    if (nextConflicts.length) {
      const conflictDates = new Set(nextConflicts.map((c) => c.dateStr))
      const existingNext = await loadWeekAvailability(profileId, nextWeekStartStr)
      conflictDates.forEach((d) => {
        proposedNextByDate[d] = rowToEditDay(existingNext[d])
      })
    }
    const { error: syncError } = await saveWeekAvailability(profileId, nextWeekStartStr, proposedNextByDate)
    setSaving(false)
    if (syncError) {
      setMessage(`Availability saved, but syncing to next week failed: ${syncError.message}`)
      return
    }
    // Next Week's own section has no idea we just rewrote its rows — tell the parent so it can
    // bump Next Week's refreshToken and make that section re-fetch and show what's actually in
    // the database now, instead of the stale snapshot it loaded when the page first opened.
    onSyncedNextWeek?.()
    setMessage(
      nextConflicts.length
        ? `Availability saved and synced to next week (${nextConflicts.length} day${nextConflicts.length > 1 ? 's' : ''} left as-is — conflicts with leave).`
        : 'Availability saved and synced to next week.'
    )
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
              disabled={savingLock || !lockLoaded}
              onChange={(e) => onToggleLocked(e.target.checked)}
            />
            Lock time pattern
          </label>
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={copyLastWeek} disabled={!editState}>
            Copy last week
          </Button>
        </div>
      </div>
      {locked && otherWeekLocked && isThisWeek && (
        <p className="mb-2 text-xs text-gray-400">Saving This Week will also copy it into Next Week.</p>
      )}

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
