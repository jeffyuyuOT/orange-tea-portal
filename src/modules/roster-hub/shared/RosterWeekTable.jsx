import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { addDays, format, parseISO } from 'date-fns'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName, pendingRosterName } from '../../../lib/excelRoster'

// Renders one week's schedule as a grid: staff down the side, weekdays
// across the top. Used by both "My Roster" (filtered to one staff member)
// and the Bulletin Board's store-wide Roster view.
export default function RosterWeekTable({ period, onlyProfileId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [orderByProfile, setOrderByProfile] = useState(new Map())
  const [orderByPendingName, setOrderByPendingName] = useState(new Map())

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
      // qualified (profiles.qualified, migration 0049_staff_qualified.sql)
      // is what shows a not-yet-Qualified person's name/shift time in red
      // below — same flag Manage Roster's grid uses.
      .select('*, profiles(first_name, last_name, qualified)')
      .eq('roster_period_id', period.id)
    if (onlyProfileId) q = q.eq('profile_id', onlyProfileId)
    // roster_display_name is per-store — fetch it for THIS period's store
    // separately and fold it onto each entry's profile below, since a
    // roster_entries row itself carries no store_id of its own.
    // roster_order (migration 0059_roster_staff_order_and_hide.sql) comes
    // from the same user_stores row for real staff, and from
    // roster_pending_staff for a not-yet-formal name — both share one
    // numbering space (Roster Hub > Setting > Roster Staff Order reorders
    // them together), matched onto ad-hoc `staff_name_raw` entries by name
    // below since roster_entries itself has no pending-staff id to join on.
    Promise.all([
      q.order('work_date'),
      supabase.from('user_stores').select('profile_id, roster_display_name, roster_order').eq('store_id', period.store_id),
      supabase.from('roster_pending_staff').select('display_name, roster_display_name, roster_order').eq('store_id', period.store_id),
    ]).then(([{ data }, { data: nameRows }, { data: pendingRows }]) => {
      if (!active) return
      const nameByProfile = new Map((nameRows ?? []).map((r) => [r.profile_id, r.roster_display_name]))
      const orderByProfile = new Map((nameRows ?? []).map((r) => [r.profile_id, r.roster_order]))
      const orderByPendingName = new Map((pendingRows ?? []).map((p) => [pendingRosterName(p).toLowerCase(), p.roster_order]))
      setEntries(
        (data ?? []).map((e) => ({
          ...e,
          profiles: e.profiles ? { ...e.profiles, roster_display_name: nameByProfile.get(e.profile_id) } : e.profiles,
        }))
      )
      setOrderByProfile(orderByProfile)
      setOrderByPendingName(orderByPendingName)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [period, onlyProfileId])

  if (loading) return <LoadingSpinner />
  if (!period) return <EmptyState label="Not available — this week's roster hasn't been published yet." />
  if (!entries.length) return <EmptyState label="No shifts recorded for this week." />

  const days = Array.from({ length: 7 }, (_, i) => addDays(parseISO(period.week_start_date), i))
  // Sorted by Roster Hub > Setting > Roster Staff Order (migration
  // 0059_roster_staff_order_and_hide.sql) — the same order Manage Roster's
  // own grid uses — instead of alphabetically: Jeff (2026-09) pointed out
  // this table (shared by Bulletin Board's Roster view and My Roster) had
  // fallen out of step with that setting, so a manager reordering staff
  // there never showed up here. A real staff member's order comes from
  // their user_stores row; a not-yet-formal name's comes from
  // roster_pending_staff, matched by name since roster_entries only carries
  // a raw typed name, not a pending-staff id — both share one numbering
  // space, so they interleave correctly rather than "real staff always
  // first". Anyone with no order on record at all (a one-off name typed
  // straight into Manage Roster that was never added to Pending staff)
  // falls back to alphabetical, after everyone with a real position.
  const staffNames = Array.from(
    new Map(
      entries.map((e) => [
        e.profile_id ?? e.staff_name_raw,
        {
          name: e.profiles ? rosterDisplayName(e.profiles) : e.staff_name_raw,
          isStaff: !!e.profile_id,
          qualified: e.profiles?.qualified === true,
          order: e.profile_id ? orderByProfile.get(e.profile_id) : orderByPendingName.get((e.staff_name_raw || '').toLowerCase()),
        },
      ])
    )
  ).sort(([, a], [, b]) => {
    if (a.order != null && b.order != null) return a.order - b.order
    if ((a.order != null) !== (b.order != null)) return a.order != null ? -1 : 1
    return (a.name || '').localeCompare(b.name || '')
  })

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-100">
      <table className="min-w-full divide-y divide-brand-100 text-sm">
        <thead className="bg-brand-50">
          <tr>
            {/* Sticky staff column — on a narrow phone screen this table has
                to scroll sideways to see the later weekdays, so this stays
                pinned in place (same trick as Leave Schedule's mobile sticky
                date column) rather than scrolling the name out of view too. */}
            <th className="sticky left-0 z-10 bg-brand-50 px-3 py-2 text-left font-medium text-brand-700">Staff</th>
            {days.map((d) => (
              <th key={d.toISOString()} className="px-3 py-2 text-left font-medium text-brand-700">
                {format(d, 'EEE d/M')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-50">
          {staffNames.map(([key, info]) => {
            // Not-yet-Qualified (profiles.qualified) real staff get their
            // name and shift time shown in red — same flag/reasoning as
            // Manage Roster's grid. Pending/imported/manual names
            // (isStaff false) never carry this concept.
            const notQualified = info.isStaff && !info.qualified
            return (
              <tr key={key}>
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-700">
                  <div className={notQualified ? 'text-red-600' : undefined} title={notQualified ? 'Not yet Qualified' : undefined}>
                    {info.name || 'Unassigned'}
                  </div>
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
                          <div className={`whitespace-nowrap ${notQualified ? 'text-red-600 font-medium' : ''}`}>
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
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
