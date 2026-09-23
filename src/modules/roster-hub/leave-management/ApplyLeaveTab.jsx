import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { HALF_HOUR_TIMES, buildLeaveTimestamps, formatTimeLabel, leaveTooltipLabel, todayDateInput } from './leaveDates'

export default function ApplyLeaveTab() {
  const { profile, currentStoreId } = useAuth()
  const [startDate, setStartDate] = useState(todayDateInput())
  const [endDate, setEndDate] = useState(todayDateInput())
  // Most leave is whole days — time only matters when someone needs a
  // partial day, so it stays hidden until this is checked.
  const [includeTime, setIncludeTime] = useState(false)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [reason, setReason] = useState('')
  const [overlapping, setOverlapping] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const timestamps = buildLeaveTimestamps({ startDate, endDate, includeTime, startTime, endTime })

  useEffect(() => {
    if (!startDate || !endDate || !currentStoreId) {
      setOverlapping([])
      return
    }
    supabase
      .from('leave_requests')
      .select('*, profiles(first_name,last_name)')
      .eq('store_id', currentStoreId)
      .eq('status', 'active')
      .lt('start_at', timestamps.end_at)
      .gt('end_at', timestamps.start_at)
      .then(({ data }) => setOverlapping(data ?? []))
    // timestamps is derived fresh every render from these same inputs, so
    // depending on its fields directly avoids re-running on every render.
  }, [startDate, endDate, includeTime, startTime, endTime, currentStoreId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setSubmitting(true)
    setMessage('')
    const { error } = await supabase.from('leave_requests').insert({
      profile_id: profile.id,
      store_id: currentStoreId,
      ...timestamps,
      reason,
    })
    setSubmitting(false)
    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Leave registered.')
      setStartDate(todayDateInput())
      setEndDate(todayDateInput())
      setIncludeTime(false)
      setReason('')
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Start date</span>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">End date</span>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={includeTime} onChange={(e) => setIncludeTime(e.target.checked)} />
        Specify time (leave unchecked for a whole-day leave)
      </label>

      {includeTime && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Start time</span>
            <select className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)}>
              {HALF_HOUR_TIMES.map((t) => (
                <option key={t} value={t}>
                  {formatTimeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">End time</span>
            <select className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)}>
              {HALF_HOUR_TIMES.map((t) => (
                <option key={t} value={t}>
                  {formatTimeLabel(t)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Reason (optional)</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>

      {startDate && endDate && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">Others on leave during this period:</p>
          {overlapping.length === 0 ? (
            <EmptyState label="No one else is on leave in this window." />
          ) : (
            <ul className="space-y-1 text-sm text-gray-600">
              {overlapping.map((l) => (
                <li key={l.id}>
                  {l.profiles?.first_name} {l.profiles?.last_name}: {leaveTooltipLabel(l)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button onClick={submit} disabled={submitting || !startDate || !endDate}>
        {submitting ? 'Submitting…' : 'Confirm & Register Leave'}
      </Button>
      {message && <p className="text-sm text-brand-600">{message}</p>}
    </div>
  )
}
