import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { findBlockedDate } from '../../../lib/leaveLimits'
import { brisbaneLocalToIso } from '../../../lib/brisbaneTime'
import LeaveDateRangeFields from './LeaveDateRangeFields'

// Jeff, 2026-09-30: "Leave申請的時候，start的時間預設是一天的開始(12am)，End
// 的時間預設是一天的最後,而不是當下的時間，因為通常leave是請一整天，除非有特定
// 時段才會自己去輸入時間" -- leave is normally requested for a whole day, so
// default Start/End to today's 00:00/23:59 instead of the browser's "now"
// (a bare `useState('')` datetime-local input just shows the current time
// when first opened). Editing only the date portion of a datetime-local
// input via its native picker leaves the time portion untouched, so picking
// a different day keeps these same full-day bounds -- someone who actually
// needs a partial-day leave can still type a specific time in manually.
function pad2(n) {
  return String(n).padStart(2, '0')
}
function todayAt(hh, mm) {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(hh)}:${pad2(mm)}`
}

export default function ApplyLeaveTab() {
  const { profile, currentStoreId } = useAuth()
  const [startAt, setStartAt] = useState(() => todayAt(0, 0))
  const [endAt, setEndAt] = useState(() => todayAt(23, 59))
  // Jeff, 2026-10-02: "specific time" checkbox — unchecked (the default,
  // matching the whole-day-by-default behavior above) shows date-only
  // pickers; checking it reveals the full start/end time pickers. See
  // LeaveDateRangeFields.jsx.
  const [specificTime, setSpecificTime] = useState(false)
  const [reason, setReason] = useState('')
  const [overlapping, setOverlapping] = useState([])
  // This store's leave-limit settings (Roster Hub > Setting > Leave
  // limits) — loaded once per store, then checked against `overlapping`
  // below whenever the picked dates change.
  const [limitDefaults, setLimitDefaults] = useState(null)
  const [limitPeriods, setLimitPeriods] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!currentStoreId) return
    Promise.all([
      supabase.from('leave_limit_defaults').select('*').eq('store_id', currentStoreId).maybeSingle(),
      supabase.from('leave_limit_periods').select('*').eq('store_id', currentStoreId),
    ]).then(([{ data: d }, { data: p }]) => {
      setLimitDefaults(d ?? null)
      setLimitPeriods(p ?? [])
    })
  }, [currentStoreId])

  useEffect(() => {
    if (!startAt || !endAt || !currentStoreId || endAt < startAt) {
      setOverlapping([])
      return
    }
    // Jeff, 2026-10-02: compared against the raw datetime-local strings
    // before — same missing-timezone bug as the insert below (see
    // brisbaneTime.js), which could make this overlap check itself wrong
    // by up to 10 hours. Converted the same way for an accurate comparison.
    supabase
      .from('leave_requests')
      .select('*, profiles(first_name,last_name)')
      .eq('store_id', currentStoreId)
      .eq('status', 'active')
      .lt('start_at', brisbaneLocalToIso(endAt))
      .gt('end_at', brisbaneLocalToIso(startAt))
      .then(({ data }) => setOverlapping(data ?? []))
  }, [startAt, endAt, currentStoreId])

  // Jeff, 2026-10-02: "end的日期比開始日期還早要跳出錯誤提示" — every
  // date-range picker needs this same guard; this is Apply Leave's.
  const rangeInvalid = startAt && endAt && endAt < startAt

  // The first day (if any) in the picked range that's already at this
  // store's leave-limit cap, checked against everyone ELSE already on
  // active leave that day — not counting this application itself, since
  // it's the one asking to be added.
  const blockedDate =
    startAt && endAt ? findBlockedDate(startAt, endAt, limitDefaults, limitPeriods, overlapping) : null

  async function submit() {
    if (rangeInvalid) {
      setMessage('Error: End date/time can’t be before the start.')
      return
    }
    if (blockedDate) {
      alert(
        `Leave is full for ${new Date(`${blockedDate.dateKey}T00:00:00`).toLocaleDateString()} (max ${blockedDate.max} ` +
          `people already on leave) — this leave request can't be submitted for that period.`
      )
      return
    }
    setSubmitting(true)
    setMessage('')
    const { error } = await supabase.from('leave_requests').insert({
      profile_id: profile.id,
      store_id: currentStoreId,
      start_at: brisbaneLocalToIso(startAt),
      end_at: brisbaneLocalToIso(endAt),
      reason,
    })
    setSubmitting(false)
    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Leave registered.')
      setStartAt(todayAt(0, 0))
      setEndAt(todayAt(23, 59))
      setSpecificTime(false)
      setReason('')
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <LeaveDateRangeFields
        startAt={startAt}
        endAt={endAt}
        specificTime={specificTime}
        onChange={(next) => {
          setStartAt(next.startAt)
          setEndAt(next.endAt)
          setSpecificTime(next.specificTime)
        }}
      />
      {rangeInvalid && <p className="text-sm text-red-600">End date/time can’t be before the start.</p>}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Reason (optional)</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>

      {startAt && endAt && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">Others on leave during this period:</p>
          {overlapping.length === 0 ? (
            <EmptyState label="No one else is on leave in this window." />
          ) : (
            <ul className="space-y-1 text-sm text-gray-600">
              {overlapping.map((l) => (
                <li key={l.id}>
                  {l.profiles?.first_name} {l.profiles?.last_name}: {new Date(l.start_at).toLocaleString()} –{' '}
                  {new Date(l.end_at).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {blockedDate && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Leave is full for {new Date(`${blockedDate.dateKey}T00:00:00`).toLocaleDateString()} (max {blockedDate.max}{' '}
          people) — this request can't be submitted as-is.
        </div>
      )}

      <Button onClick={submit} disabled={submitting || !startAt || !endAt || rangeInvalid}>
        {submitting ? 'Submitting…' : 'Confirm & Register Leave'}
      </Button>
      {message && <p className="text-sm text-brand-600">{message}</p>}
    </div>
  )
}
