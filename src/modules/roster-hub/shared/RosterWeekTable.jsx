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
    // No published period for this week (e.g. next week's roster hasn't
    // been submitted yet) — there's nothing to fetch, so this must still
    // turn `loading` off itself. Leaving it untouched here was a bug: with
    // `loading` starting `true` and no period ever coming in, the "no
    // roster published yet" message below could never actually be reached
    // and the spinner would just spin forever instead.
    if (!period) {
      setEntries([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
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
  if (!period) return <EmptyState label="Not available — this week's roster hasn't been published yet." />
  if (!entries.length) return <EmptyState label="No shifts recorded for this week." />

  const days = Array.from({ length: 7 }, (_, i) => addDays(parseISO(period.week_start_date), i))
  // Real staff (has a profile_id) first, then everyone else (Pending
  // staff/imported/manual names, which roster_entries can't tell apart from
  // each other) — both groups alphabetical by the same display name shown
  // on screen. This is the same rule Manage Roster's staff list now sorts
  // by (see ManageRosterPage.jsx), so this table lines up with it instead
  // of showing names in Supabase's arbitrary default order.
  const staffNames = Array.from(
    new Map(
      entries.map((e) => [
        e.profile_id ?? e.staff_name_raw,
        { name: e.profiles ? rosterDisplayName(e.profiles) : e.staff_name_raw, isStaff: !!e.profile_id },
      ])
    )
  ).sort(([, a], [, b]) => {
    if (a.isStaff !== b.isStaff) return a.isStaff ? -1 : 1
    return (a.name || '').localeCompare(b.name || '')
  })

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
          {staffNames.map(([key, info]) => (
            <tr key={key}>
              <td className="px-3 py-2 font-medium text-gray-700">
                <div>{info.name || 'Unassigned'}</div>
                {/* "Break" label lives once under the name (in red) instead of being
                    repeated in every day cell — each cell below then only needs to
                    show the count, per Jeff, since everyone already knows what it
                    refers to and one break = 30 min. */}
                <div className="text-xs font-normal text-red-500">Break</div>
              </td>
              {days.map((d) => {
                const dayStr = format(d, 'yyyy-MM-dd')
                const shift = entries.find(
                  (e) => (e.profile_id ?? e.staff_name_raw) === key && e.work_date === dayStr
                )
                return (
                  <td key={dayStr} className="px-3 py-2 text-gray-600">
                    {shift ? (
                      <>
                        <div className="whitespace-nowrap">
                          {shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)}
                        </div>
                        {shift.break_half_hours ? (
                          <div className="text-xs text-red-500">x{shift.break_half_hours}</div>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
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
