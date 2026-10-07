import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { addDays, format, parseISO } from 'date-fns'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName, pendingRosterName } from '../../../lib/excelRoster'
import { NON_ROSTER_STAFF_ROLES } from '../../../lib/permissions'
import { isActiveStoreMember } from '../../../lib/storeVisibility'
import { loadRosterDisplaySettings, rosterTitleStyle } from '../../../lib/trainingJourney'

// Renders one week's schedule as a grid: staff down the side, weekdays
// across the top. Used by both "My Roster" (filtered to one staff member)
// and the Bulletin Board's store-wide Roster view.
export default function RosterWeekTable({ period, onlyProfileId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [orderByProfile, setOrderByProfile] = useState(new Map())
  const [orderByPendingName, setOrderByPendingName] = useState(new Map())
  // Jeff, 2026-09: "沒有時間的人也是要顯示出來(如果在manage roster有出現名字
  // 的話)" — a staff/pending person can appear on Manage Roster's grid
  // (they're on this store's active roster) with literally zero hours
  // entered for the whole week, and until now that meant zero
  // roster_entries rows, so they never showed up here at all — this view
  // used to be built purely FROM roster_entries. `activeRoster` is that
  // same "who'd show up as a row in Manage Roster" list (same filters
  // ManageRosterPage applies to its own `staff`/`pendingStaff`), fetched
  // here too so it can be unioned onto the entries-derived list below.
  // Only for the store-wide view — onlyProfileId (My Roster) keeps its
  // existing "no shifts recorded" behavior for a genuinely shift-less week,
  // since that page is about THIS person's own shifts, not who's on the
  // roster in general.
  const [activeRoster, setActiveRoster] = useState([])

  // Jeff, 2026-10-02 (Training Journey spec, point 6): System Setting >
  // Roster Name Display Format + the 6 phase definitions — fetched once
  // (these barely ever change), not re-fetched every time `period` changes.
  // 'original' is the default and preserves today's exact qualified-only
  // red/default behavior below untouched.
  const [displayFormat, setDisplayFormat] = useState('original')
  const [phases, setPhases] = useState([])
  useEffect(() => {
    loadRosterDisplaySettings().then(setDisplayFormat)
    supabase
      .from('training_journey_phases')
      .select('*')
      .then(({ data }) => setPhases(data ?? []))
  }, [])

  useEffect(() => {
    // No published period for this week (e.g. next week's roster hasn't
    // been submitted yet) — there's nothing to fetch, so this must still
    // turn `loading` off itself. Leaving it untouched here was a bug: with
    // `loading` starting `true` and no period ever coming in, the "no
    // roster published yet" message below could never actually be reached
    // and the spinner would just spin forever instead.
    if (!period) {
      setEntries([])
      setActiveRoster([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    let q = supabase.from('roster_entries').select('*').eq('roster_period_id', period.id)
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
    //
    // Jeff, 2026-09-29: name/is_active/role/qualified/join_store_activity
    // used to come from a `profiles(...)` embed on the two queries below,
    // but that embed is gated by `profiles`' own RLS (own row, or
    // admin/shop_manager) — a plain staff viewer got `profiles: null` for
    // every colleague, which made every colleague show up "not yet
    // Qualified" (red) and silently dropped any zero-shift colleague from
    // the grid entirely (see migration 0077_roster_colleague_visibility.sql
    // for the root cause). `store_roster_profiles` is a narrow RPC scoped
    // to exactly the fields this table needs — same result for every role,
    // admin/shop_manager/staff alike, since it's not gated by `profiles`
    // RLS at all (it's SECURITY DEFINER, authorized instead by "does the
    // caller currently have access to this store", same as
    // roster_entries/announcements already are).
    Promise.all([
      q.order('work_date'),
      supabase
        .from('user_stores')
        .select('profile_id, roster_display_name, roster_order, hidden_from_roster')
        .eq('store_id', period.store_id),
      supabase
        .from('roster_pending_staff')
        .select('id, display_name, roster_display_name, roster_order, hidden_from_roster')
        .eq('store_id', period.store_id),
      supabase.rpc('store_roster_profiles', { p_store_id: period.store_id }),
      // Jeff, 2026-10-02 (Training Journey spec, point 6): a second, equally
      // narrow RPC for the Training Journey fields the title display modes
      // below need. Jeff, 2026-10-07 (8-point phase-merge request, point 1):
      // back to the original store_roster_titles (migration 0092) —
      // {training_journey_phase, has_master_title} is now the full shape
      // again, since the Expert tier (and has_expert_title) was merged away
      // by migration 0096. store_roster_titles_v2 (added when Expert needed
      // its own column that store_roster_titles couldn't be widened to add
      // without a DROP FUNCTION) is left in place, unused, rather than
      // dropped — this codebase's standing rule.
      supabase.rpc('store_roster_titles', { p_store_id: period.store_id }),
    ]).then(([{ data }, { data: nameRows }, { data: pendingRows }, { data: profileRows }, { data: titleRows }]) => {
      if (!active) return
      const titleById = new Map((titleRows ?? []).map((t) => [t.id, t]))
      const profileById = new Map((profileRows ?? []).map((p) => [p.id, { ...p, ...titleById.get(p.id) }]))
      const nameByProfile = new Map((nameRows ?? []).map((r) => [r.profile_id, r.roster_display_name]))
      const orderByProfile = new Map((nameRows ?? []).map((r) => [r.profile_id, r.roster_order]))
      const orderByPendingName = new Map((pendingRows ?? []).map((p) => [pendingRosterName(p).toLowerCase(), p.roster_order]))
      setEntries(
        (data ?? []).map((e) => {
          const p = e.profile_id ? profileById.get(e.profile_id) : null
          return {
            ...e,
            profiles: p ? { ...p, roster_display_name: nameByProfile.get(e.profile_id) } : null,
          }
        })
      )
      setOrderByProfile(orderByProfile)
      setOrderByPendingName(orderByPendingName)
      if (onlyProfileId) {
        setActiveRoster([])
      } else {
        // Same filters as ManageRosterPage's own staff query: active,
        // schedulable role, not hidden from this store's roster, and
        // counted as an active participant here (isActiveStoreMember,
        // migration 0064/0067).
        const activeStaff = (nameRows ?? [])
          .map((r) => ({ ...r, profiles: profileById.get(r.profile_id) }))
          .filter(
            (r) =>
              r.profiles?.is_active &&
              !NON_ROSTER_STAFF_ROLES.includes(r.profiles.role) &&
              !r.hidden_from_roster &&
              isActiveStoreMember(r.profiles, period.store_id)
          )
          .map((r) => ({
            key: r.profile_id,
            name: rosterDisplayName({ ...r.profiles, roster_display_name: r.roster_display_name }),
            isStaff: true,
            qualified: r.profiles.qualified === true,
            training_journey_phase: r.profiles.training_journey_phase,
            has_master_title: r.profiles.has_master_title,
            order: r.roster_order,
          }))
        const activePending = (pendingRows ?? [])
          .filter((p) => !p.hidden_from_roster)
          .map((p) => ({
            key: pendingRosterName(p),
            name: pendingRosterName(p),
            isStaff: false,
            qualified: false,
            order: p.roster_order,
          }))
        setActiveRoster([...activeStaff, ...activePending])
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [period, onlyProfileId])

  if (loading) return <LoadingSpinner />
  if (!period) return <EmptyState label="Not available — this week's roster hasn't been published yet." />
  if (!entries.length && !activeRoster.length) return <EmptyState label="No shifts recorded for this week." />

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
  const byKey = new Map(
    entries.map((e) => [
      e.profile_id ?? e.staff_name_raw,
      {
        name: e.profiles ? rosterDisplayName(e.profiles) : e.staff_name_raw,
        isStaff: !!e.profile_id,
        qualified: e.profiles?.qualified === true,
        training_journey_phase: e.profiles?.training_journey_phase,
        has_master_title: e.profiles?.has_master_title,
        order: e.profile_id ? orderByProfile.get(e.profile_id) : orderByPendingName.get((e.staff_name_raw || '').toLowerCase()),
      },
    ])
  )
  // Union on anyone who's on this store's active roster but has no shift
  // at all this week (see activeRoster above) — never overwrites someone
  // who already has real entries.
  activeRoster.forEach((r) => {
    if (!byKey.has(r.key)) byKey.set(r.key, r)
  })
  const staffNames = Array.from(byKey).sort(([, a], [, b]) => {
    if (a.order != null && b.order != null) return a.order - b.order
    if ((a.order != null) !== (b.order != null)) return a.order != null ? -1 : 1
    return (a.name || '').localeCompare(b.name || '')
  })

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-100">
      {/* Jeff, 2026-10-02: "手機板bulletin裡的roster...名字跟時間的字能小一
          點嗎，這樣手機螢幕可以看到多一點的資訊" — text-sm/text-xs below
          (and the cell padding) now only apply from the `sm` breakpoint up;
          on a phone it drops a size (text-xs/text-[11px]) so more of the
          week is visible per screen without scrolling as much. Desktop is
          completely unaffected. */}
      <table className="min-w-full divide-y divide-brand-100 text-xs sm:text-sm">
        <thead className="bg-brand-50">
          <tr>
            {/* Sticky staff column — on a narrow phone screen this table has
                to scroll sideways to see the later weekdays, so this stays
                pinned in place (same trick as Leave Schedule's mobile sticky
                date column) rather than scrolling the name out of view too. */}
            <th className="sticky left-0 z-10 bg-brand-50 px-2 py-1.5 text-left font-medium text-brand-700 sm:px-3 sm:py-2">
              Staff
            </th>
            {days.map((d) => (
              <th key={d.toISOString()} className="px-2 py-1.5 text-left font-medium text-brand-700 sm:px-3 sm:py-2">
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
            // (isStaff false) never carry this concept. Only actually used
            // when displayFormat is 'original' — see titleStyle below for
            // the two Training Journey title display modes.
            const notQualified = info.isStaff && !info.qualified
            // Jeff, 2026-10-02 (Training Journey spec, point 6): under
            // 'title_crown'/'title_no_crown', name/time color comes from
            // this instead — null in 'original' mode, so the ?? fallbacks
            // below just render exactly as they always have.
            const titleStyle = displayFormat !== 'original' && info.isStaff ? rosterTitleStyle(info, phases, displayFormat) : null
            const nameColorStyle = titleStyle?.color ? { color: titleStyle.color } : undefined
            const timeClassName = `whitespace-nowrap ${
              displayFormat === 'original' && notQualified ? 'text-red-600 font-medium' : ''
            }`
            return (
              <tr key={key}>
                <td className="sticky left-0 z-10 bg-white px-2 py-1.5 font-medium text-gray-700 sm:px-3 sm:py-2">
                  <div
                    className={displayFormat === 'original' && notQualified ? 'text-red-600' : undefined}
                    style={nameColorStyle}
                    title={displayFormat === 'original' && notQualified ? 'Not yet Qualified' : undefined}
                  >
                    {info.name || 'Unassigned'}
                    {titleStyle?.icon && (
                      <span className="ml-1" title="Master">
                        {titleStyle.icon}
                      </span>
                    )}
                    {titleStyle?.badge && <span className="ml-1 text-[10px] font-normal text-gray-400">{titleStyle.badge}</span>}
                  </div>
                  {/* "Break" label lives once under the name (in red) instead of being
                      repeated in every day cell — each cell below then only needs to
                      show the count, per Jeff, since everyone already knows what it
                      refers to and one break = 30 min. Stays red in every display
                      format — never tied to qualified/title, per Jeff. */}
                  <div className="text-[11px] font-normal text-red-500 sm:text-xs">Break</div>
                </td>
                {days.map((d) => {
                  const dayStr = format(d, 'yyyy-MM-dd')
                  const shift = entries.find(
                    (e) => (e.profile_id ?? e.staff_name_raw) === key && e.work_date === dayStr
                  )
                  // Jeff, 2026-10-04: an ad-hoc/casual name with no hours at
                  // all for the whole week now gets a single placeholder
                  // roster_entries row (ManageRosterPage.jsx's doPersist)
                  // just so the name itself survives into the DB — it's
                  // null start/end, not a real shift, so it renders exactly
                  // like any other day with no shift (the "—" below) rather
                  // than a blank time range.
                  const hasShift = shift && (shift.start_time || shift.end_time)
                  return (
                    <td key={dayStr} className="px-2 py-1.5 text-gray-600 sm:px-3 sm:py-2">
                      {hasShift ? (
                        <>
                          <div className={timeClassName} style={nameColorStyle}>
                            {shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)}
                          </div>
                          {shift.break_half_hours ? (
                            <div className="text-[11px] text-red-500 sm:text-xs">x{shift.break_half_hours}</div>
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
