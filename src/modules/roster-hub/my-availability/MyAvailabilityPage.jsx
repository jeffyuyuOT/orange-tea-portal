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
  describeDay,
  loadWeekLocks,
  setWeekLock,
  findMostRecentLockedWeek,
} from '../../../lib/availability'
import TimeOfDaySelect from './TimeOfDaySelect'
import {
  loadStoreCutoff,
  formatCutoff,
  isApprovalExempt,
  getAvailabilityWeekLock,
  lockReasonText,
  buildAvailabilityDetails,
  createChangeRequest,
  loadPendingAvailability,
  cancelChangeRequest,
} from '../../../lib/scheduleLock'

// Jeff, 2026-09: "在roster hub新增my availability...裡面像my roster一樣顯示
// this week...跟next week...兩個區塊" — same This Week / Next Week shape as
// My Roster, but each section is its own self-contained editor (own load,
// own Copy-last-week, own Save) rather than one shared form, since a save on
// one week has no bearing on the other.
export default function MyAvailabilityPage() {
  const { profile, currentStoreId } = useAuth()
  const thisWeekStr = thisWeekStart()
  // Jeff, 2026-11-27: always-visible explanation of when staff can no longer change availability
  // themselves (cut-off passed / roster submitted -> needs manager approval).
  const [pageCutoff, setPageCutoff] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!currentStoreId) return
    loadStoreCutoff(currentStoreId).then((c) => {
      if (!cancelled) setPageCutoff(c)
    })
    return () => {
      cancelled = true
    }
  }, [currentStoreId])
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

      {(
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <b>When can I change my availability?</b>
          {isApprovalExempt(profile) && (
            <p className="mt-1 text-xs text-amber-700">
              Your role (manager / admin / developer) isn't held up by this — you can always change your own availability.
              Staff are restricted as follows:
            </p>
          )}
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            <li>
              Next week's availability can be changed by yourself until{' '}
              <b>{pageCutoff && pageCutoff.weekday != null ? formatCutoff(pageCutoff.weekday, pageCutoff.time) : 'the weekly cut-off'}</b>{' '}
              (Brisbane time) this week.
            </li>
            <li>Once the roster for a week has been submitted, that week can't be changed by yourself either.</li>
            <li>
              After either of these, press "Submit for approval" — your change only takes effect once{' '}
              {pageCutoff?.approverId ? pageCutoff.approverName : 'your manager'} approves it. Until then it shows as
              "Waiting for manager approval".
            </li>
          </ul>
        </div>
      )}

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

// Jeff, 2026-10-29: "如果下禮拜是沒資料的情況下" — "no data" means every day
// in the week is still sitting at the bare default rowToEditDay produces
// for a day with no saved row at all (mode 'all_available', no boundary,
// no custom windows) — i.e. the person hasn't touched this week yet.
function isWeekUntouched(editState, dates) {
  return dates.every((d) => {
    const day = editState?.[d]
    return day?.mode === 'all_available' && !(day.windows?.length)
  })
}

// Jeff, 2026-10-29: the two notes behind the ⓘ next to "Lock time pattern"
// — kept as the exact English Jeff gave, verbatim (this is a bilingual
// app; the staff-facing UI text itself stays English like the rest of the
// page, only Claude's own commit/explanation messages are in Chinese).
const LOCK_INFO_NOTES = [
  "You cannot modify the time while 'Lock Time Pattern' is checked. To change the time, you must first uncheck it.",
  "If there is no data for next week, checking 'Lock Time Pattern' will load the record from the most recent locked pattern. Please click 'Save' to apply your changes.",
]

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
  const [showLockInfo, setShowLockInfo] = useState(false)
  // Jeff, 2026-11-27 (Availability Cut-off Settings): `lock` says whether THIS week can still be
  // changed directly — { needsApproval, reason: 'cutoff' | 'roster_submitted', cutoff } — and
  // `pending` is this person's change for this week that's still waiting for the approver.
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const [lock, setLock] = useState(null)
  const [pending, setPending] = useState(null)
  // Jeff, 2026-11-28: days whose new times are still waiting for the approver — shown faded with a
  // red "Waiting for approval" note, and the popup explaining that nothing changes until approval.
  const [pendingDates, setPendingDates] = useState(() => new Set())
  const [showApprovalNotice, setShowApprovalNotice] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const storeIdsKey = (accessibleStores ?? []).map((s) => s.id).join(',')

  useEffect(() => {
    let cancelled = false
    if (!profileId || !currentStoreId) return
    ;(async () => {
      const storeIds = Array.from(new Set([currentStoreId, ...(accessibleStores ?? []).map((s) => s.id)]))
      const cutoff = await loadStoreCutoff(currentStoreId)
      const lk = await getAvailabilityWeekLock({ profile, storeIds, cutoff, weekStart })
      const pend = await loadPendingAvailability(profileId, weekStart)
      if (cancelled) return
      setLock({ ...lk, cutoff })
      setPending(pend)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, weekStart, currentStoreId, storeIdsKey, profile?.role, refreshToken])

  useEffect(() => {
    let cancelled = false
    setEditState(null)
    setMessage('')
    if (!profileId) return
    Promise.all([loadWeekAvailability(profileId, weekStart), loadPendingAvailability(profileId, weekStart)]).then(([byDate, pend]) => {
      if (cancelled) return
      const next = {}
      dates.forEach((d) => {
        next[d] = rowToEditDay(byDate[d])
      })
      // A change still waiting for the approver: show its proposed times (faded) on the days it touches.
      const waiting = new Set()
      if (pend) {
        ;(pend.payload?.changedDates ?? []).forEach((d) => {
          const proposed = pend.payload?.days?.[d]
          if (next[d] && proposed) {
            next[d] = { mode: proposed.mode, boundaryTime: proposed.boundaryTime || '', windows: proposed.windows ?? [] }
            waiting.add(d)
          }
        })
      }
      setPendingDates(waiting)
      setEditState(next)
    })
    return () => {
      cancelled = true
    }
    // dates is derived fresh from weekStart every render — only weekStart/profileId (and, for
    // Next Week, a bump of refreshToken right after This Week's sync writes new rows for this
    // same week) should re-trigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, weekStart, refreshToken, reloadTick])

  function updateDay(dateStr, patch) {
    setEditState((prev) => ({ ...prev, [dateStr]: { ...prev[dateStr], ...patch } }))
    setPendingDates((prev) => {
      if (!prev.has(dateStr)) return prev
      const next = new Set(prev)
      next.delete(dateStr)
      return next
    })
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

  // Jeff, 2026-10-29: "勾取lock time pattern的時候不能更改時間...如果下禮拜
  // 是沒資料的情況下，勾取lock time pattern會抓取最近一次lock time pattern
  // 的紀錄去載入" — wraps the parent's onToggleLocked (which just persists
  // the lock row itself) with the one piece of behaviour that needs the
  // section's own editState: turning the lock ON for a week that's still
  // completely untouched loads the most recent previously-locked week's
  // pattern into the editor first, rather than locking today's blank
  // defaults in place. A week that already has SOME data (even if it was
  // never itself locked) just gets locked as-is — nothing is overwritten.
  async function handleToggleLocked(next) {
    if (next && editState && isWeekUntouched(editState, dates)) {
      const sourceWeekStart = await findMostRecentLockedWeek(profileId, weekStart)
      if (sourceWeekStart) {
        const sourceDates = weekDatesFrom(sourceWeekStart)
        const byDate = await loadWeekAvailability(profileId, sourceWeekStart)
        const loaded = {}
        dates.forEach((d, i) => {
          loaded[d] = rowToEditDay(byDate[sourceDates[i]])
        })
        setEditState(loaded)
        setMessage('Loaded your most recent locked pattern below — Save to keep it.')
      }
    }
    onToggleLocked(next)
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
    // Past the cut-off, or this week's roster is already submitted: the change goes to the approver
    // instead of being written straight away (nothing changes until they approve).
    if (lock?.needsApproval) {
      const approverId = lock.cutoff?.approverId
      if (!approverId) {
        setSaving(false)
        setMessage('Error: no approver has been set for this shop yet — please ask your manager.')
        return
      }
      const oldByDate = await loadWeekAvailability(profileId, weekStart)
      const details = buildAvailabilityDetails(weekStart, oldByDate, editState)
      if (!details.length) {
        setSaving(false)
        setMessage('Nothing to send — your availability is the same as what is already saved.')
        return
      }
      const changedDates = dates.filter((d) => {
        const nd = editDayToRowShape(editState[d])
        return describeDay(oldByDate?.[d]?.dayRow, oldByDate?.[d]?.windows) !== describeDay(nd.dayRow, nd.windows)
      })
      const days = {}
      dates.forEach((d) => {
        days[d] = { mode: editState[d].mode, boundaryTime: editState[d].boundaryTime || '', windows: editState[d].windows ?? [] }
      })
      const { error: reqError } = await createChangeRequest({
        profile,
        storeId: currentStoreId,
        approverId,
        kind: 'availability',
        reasonCode: lock.reason,
        weekStart,
        title: `Availability for the week of ${format(parseISO(weekStart), 'd MMM')}`,
        details,
        payload: { days, changedDates },
      })
      if (reqError) {
        setSaving(false)
        setMessage(`Error: ${reqError.message}`)
        return
      }
      setPending(await loadPendingAvailability(profileId, weekStart))
      setPendingDates(new Set(changedDates))
      setSaving(false)
      setMessage(`Sent to ${lock.cutoff.approverName} for approval — it takes effect once they approve.`)
      setShowApprovalNotice(true)
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
    const syncStoreIds = Array.from(new Set([currentStoreId, ...(accessibleStores ?? []).map((s) => s.id)]))
    const nextLock = await getAvailabilityWeekLock({ profile, storeIds: syncStoreIds, cutoff: lock?.cutoff, weekStart: nextWeekStartStr })
    if (nextLock.needsApproval) {
      setSaving(false)
      setMessage('Availability saved. Next Week was not updated — its cut-off has passed or its roster is submitted, so changes there need manager approval.')
      return
    }
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
              onChange={(e) => handleToggleLocked(e.target.checked)}
            />
            Lock time pattern
          </label>
          <button
            type="button"
            className="text-gray-400 hover:text-brand-600"
            onClick={() => setShowLockInfo(true)}
            aria-label="About Lock time pattern"
          >
            ⓘ
          </button>
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={copyLastWeek} disabled={!editState || locked}>
            Copy last week
          </Button>
        </div>
      </div>
      {locked && otherWeekLocked && isThisWeek && (
        <p className="mb-2 text-xs text-gray-400">Saving This Week will also copy it into Next Week.</p>
      )}

      {lock?.needsApproval && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          You can't change this week yourself — {lockReasonText(lock.reason, lock.cutoff)}.{' '}
          {lock.cutoff?.approverId
            ? `Edit below and press "Submit for approval"; it takes effect once ${lock.cutoff.approverName} approves.`
            : 'No approver is set for this shop yet — please ask your manager.'}
        </div>
      )}
      {pending && (
        <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
          <div className="flex items-center justify-between gap-2">
            <b>Waiting for manager approval</b>
            <button
              type="button"
              className="font-medium text-blue-700 underline"
              onClick={async () => {
                await cancelChangeRequest(pending.id)
                setPending(null)
                setPendingDates(new Set())
                setReloadTick((t) => t + 1)
                setMessage('Your request was withdrawn.')
              }}
            >
              Withdraw
            </button>
          </div>
          <ul className="mt-1 space-y-0.5">
            {(pending.details ?? []).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
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
                disabled={locked}
                pendingApproval={pendingDates.has(dateStr)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={!editState || saving || !lock}>
          {saving ? 'Saving…' : lock?.needsApproval ? 'Submit for approval' : `Save ${title}`}
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

      <Modal
        open={showApprovalNotice}
        onClose={() => setShowApprovalNotice(false)}
        title="Waiting for manager approval"
        footer={<Button onClick={() => setShowApprovalNotice(false)}>OK</Button>}
      >
        <p className="text-sm text-gray-700">
          This change needs approval — {lockReasonText(lock?.reason, lock?.cutoff)}. Your new times{' '}
          <b>only take effect once {lock?.cutoff?.approverName ?? 'your manager'} approves them</b>. Until then your current
          availability stays as it is, and the times you asked for are shown faded with a red "Waiting for approval" note.
        </p>
        <p className="mt-2 text-xs text-gray-500">You'll get a Message when it's approved or not approved. You can withdraw the request any time.</p>
      </Modal>

      <Modal
        open={showLockInfo}
        onClose={() => setShowLockInfo(false)}
        title="Lock Time Pattern"
        footer={
          <Button variant="secondary" onClick={() => setShowLockInfo(false)}>
            Close
          </Button>
        }
      >
        <ol className="list-decimal space-y-2 pl-4 text-sm text-gray-600">
          {LOCK_INFO_NOTES.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ol>
      </Modal>
    </div>
  )
}

// One day's row: the day label, its mode select, and whatever that mode
// needs — nothing (all_available/all_unavailable), a single boundary time
// (before/after), or an editable list of specific windows (custom). Jeff,
// 2026-10-29: "勾取lock time pattern的時候不能更改時間" — `disabled` (the
// section's own `locked`) greys out every control here so the displayed
// pattern can't be touched while locked; unchecking the lock is what
// re-enables editing.
function DayEditor({ label, day, onChange, disabled = false, pendingApproval = false }) {
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
    <div
      className={`flex flex-wrap items-start gap-3 px-3 py-2.5 ${
        pendingApproval ? 'bg-amber-50/70 [&_select]:border-dashed [&_select]:opacity-60' : ''
      }`}
    >
      <div className="w-20 shrink-0 pt-1.5 text-sm font-medium text-gray-700">{label}</div>

      <select
        className="input !w-52 !py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
        value={day.mode}
        disabled={disabled}
        onChange={(e) => onChange({ mode: e.target.value, boundaryTime: '', windows: e.target.value === 'custom' ? day.windows?.length ? day.windows : [{ start: '09:00', end: '17:00' }] : day.windows })}
      >
        {AVAILABILITY_MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      {(day.mode === 'before' || day.mode === 'after') && (
        <TimeOfDaySelect value={day.boundaryTime || '09:00'} onChange={(t) => onChange({ boundaryTime: t })} disabled={disabled} />
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
              <TimeOfDaySelect value={w.start} onChange={(t) => updateWindow(i, { start: t })} disabled={disabled} />
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">–</span>
                <TimeOfDaySelect value={w.end} onChange={(t) => updateWindow(i, { end: t })} disabled={disabled} />
                <button
                  type="button"
                  className="px-1.5 text-gray-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-gray-400"
                  onClick={() => removeWindow(i)}
                  disabled={disabled}
                  aria-label="Remove time range"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="self-start text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-brand-600"
            onClick={addWindow}
            disabled={disabled}
          >
            + Add time range
          </button>
        </div>
      )}
      {pendingApproval && <span className="self-center text-xs font-medium text-red-600">Waiting for approval</span>}
    </div>
  )
}
