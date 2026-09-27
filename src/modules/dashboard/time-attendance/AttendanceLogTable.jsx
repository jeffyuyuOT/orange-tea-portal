import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { pairEventsIntoSessions, dailyTotals, formatMinutes } from '../../../lib/attendance'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}
function daysAgoStr(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return format(d, 'yyyy-MM-dd')
}

// Shared by a person's own "Attendance Logs" tab (My Dashboard > Time &
// Attendance) and Shop Management > Staff Time Logs (a manager picks an
// employee, this renders the same way) — one place computing shifts/totals
// so the two views can't drift apart.
export default function AttendanceLogTable({ profileId }) {
  const [from, setFrom] = useState(daysAgoStr(6)) // default: last 7 days, inclusive
  const [to, setTo] = useState(todayStr())
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profileId) return
    let active = true
    setLoading(true)
    // Fetched unfiltered (by date) and trimmed to the selected range only
    // AFTER pairing into shifts — filtering the raw punches first could cut
    // an overnight shift's clock-in off the front of the range it belongs to.
    supabase
      .from('attendance_events')
      .select('*')
      .eq('profile_id', profileId)
      .order('occurred_at', { ascending: true })
      .then(({ data }) => {
        if (active) {
          setEvents(data ?? [])
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [profileId])

  const allSessions = pairEventsIntoSessions(events)
  const sessions = allSessions.filter((s) => s.date && s.date >= from && s.date <= to)
  const totals = dailyTotals(sessions)
  const dates = [...new Set(sessions.map((s) => s.date))].sort().reverse()

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">From</span>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} min={from} max={todayStr()} />
        </label>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !dates.length ? (
        <EmptyState label="No clock in/out records in this range." />
      ) : (
        <div className="space-y-3">
          {dates.map((date) => (
            <div key={date} className="rounded-xl border border-brand-100 bg-white p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">{format(parseISO(date), 'EEE, MMM d yyyy')}</span>
                <span className="text-sm font-medium text-brand-700">Total: {formatMinutes(totals[date])}</span>
              </div>
              <div className="space-y-1">
                {sessions
                  .filter((s) => s.date === date)
                  .map((s, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm text-gray-600">
                      <span>
                        {format(new Date(s.clockIn.occurred_at), 'h:mm a')} –{' '}
                        {s.clockOut ? format(new Date(s.clockOut.occurred_at), 'h:mm a') : 'still clocked in'}
                      </span>
                      <span className="text-gray-400">{s.inProgress ? 'In progress' : formatMinutes(s.minutes)}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
