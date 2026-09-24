import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { addDays, format, parseISO } from 'date-fns'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName } from '../../../lib/excelRoster'

// Renders one week's schedule as a grid: staff down the side, weekdays
// across the top. Used by both "My Roster" (filtered to one staff member)
// and the Bulletin Board's store-wide Roster view.
export default function RosterWeekTable({ period, onlyProfileId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!period) return
    let active = true
    let q = supabase
      .from('roster_entries')
      .select('*, profiles(first_name, last_name, roster_display_name)')
      .eq('roster_period_id', period.id)
    if (onlyProfileId) q = q.eq('profile_id', onlyProfileId)
    q.order('work_date').then(({ data }) => {
      if (active) {
        setEntries(data ?? [])
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [period, onlyProfileId])

  if (loading) return <LoadingSpinner />
  if (!period) return <EmptyState label="No roster published for this week yet." />
  if (!entries.length) return <EmptyState label="No shifts recorded for this week." />

  const days = Array.from({ length: 7 }, (_, i) => addDays(parseISO(period.week_start_date), i))
  const staffNames = Array.from(
    new Map(
      entries.map((e) => [
        e.profile_id ?? e.staff_name_raw,
        e.profiles ? rosterDisplayName(e.profiles) : e.staff_name_raw,
      ])
    )
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-100">
      <table className="min-w-full divide-y divide-brand-100 text-sm">
        <thead className="bg-brand-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-brand-700">Staff</th>
            {days.map((d) => (
              <th key={d.toISOString()} className="px-3 py-2 text-left font-medium text-brand-700">
                {format(d, 'EEE d/M')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-50">
          {staffNames.map(([key, name]) => (
            <tr key={key}>
              <td className="px-3 py-2 font-medium text-gray-700">{name || 'Unassigned'}</td>
              {days.map((d) => {
                const dayStr = format(d, 'yyyy-MM-dd')
                const shift = entries.find(
                  (e) => (e.profile_id ?? e.staff_name_raw) === key && e.work_date === dayStr
                )
                return (
                  <td key={dayStr} className="px-3 py-2 text-gray-600">
                    {shift ? `${shift.start_time?.slice(0, 5)}–${shift.end_time?.slice(0, 5)}` : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
