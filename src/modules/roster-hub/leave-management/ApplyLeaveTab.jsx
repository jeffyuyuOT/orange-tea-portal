import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { findBlockedDate } from '../../../lib/leaveLimits'

export default function ApplyLeaveTab() {
  const { profile, currentStoreId } = useAuth()
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
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
    if (!startAt || !endAt || !currentStoreId) {
      setOverlapping([])
      return
    }
    supabase
      .from('leave_requests')
      .select('*, profiles(first_name,last_name)')
      .eq('store_id', currentStoreId)
      .eq('status', 'active')
      .lt('start_at', endAt)
      .gt('end_at', startAt)
      .then(({ data }) => setOverlapping(data ?? []))
  }, [startAt, endAt, currentStoreId])

  // The first day (if any) in the picked range that's already at this
  // store's leave-limit cap, checked against everyone ELSE already on
  // active leave that day — not counting this application itself, since
  // it's the one asking to be added.
  const blockedDate =
    startAt && endAt ? findBlockedDate(startAt, endAt, limitDefaults, limitPeriods, overlapping) : null

  async function submit() {
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
      start_at: startAt,
      end_at: endAt,
      reason,
    })
    setSubmitting(false)
    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Leave registered.')
      setStartAt('')
      setEndAt('')
      setReason('')
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Start</span>
          <input type="datetime-local" className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">End</span>
          <input type="datetime-local" className="input" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </label>
      </div>
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

      <Button onClick={submit} disabled={submitting || !startAt || !endAt}>
        {submitting ? 'Submitting…' : 'Confirm & Register Leave'}
      </Button>
      {message && <p className="text-sm text-brand-600">{message}</p>}
    </div>
  )
}
