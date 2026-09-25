import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName } from '../../../lib/excelRoster'
import { leaveDisplayDates, leaveTooltipLabel } from './leaveDates'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// One color per distinct person, so all of one employee's bars this month
// read the same color at a glance — same hashing approach as the Labour
// allocation timeline's per-time-slot colors (Roster Hub > Setting).
const BAR_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#0891b2', '#ca8a04', '#db2777']
function colorForName(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return BAR_COLORS[hash % BAR_COLORS.length]
}

export default function LeaveScheduleTab() {
  const { currentStoreId } = useAuth()
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth()) // 0-based
  const [leaves, setLeaves] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentStoreId) return
    setLoading(true)
    const monthStart = new Date(viewYear, viewMonth, 1)
    const monthEndExclusive = new Date(viewYear, viewMonth + 1, 1)
    // roster_display_name is per-store — fetch it for this store separately
    // and fold it onto each leave request's profile, since leave_requests
    // itself only ever belongs to one store anyway.
    Promise.all([
      supabase
        .from('leave_requests')
        .select('*, profiles(first_name,last_name)')
        .eq('store_id', currentStoreId)
        .eq('status', 'active')
        .lt('start_at', monthEndExclusive.toISOString())
        .gt('end_at', monthStart.toISOString())
        .order('start_at'),
      supabase.from('user_stores').select('profile_id, roster_display_name').eq('store_id', currentStoreId),
    ]).then(([{ data, error }, { data: nameRows }]) => {
      if (error) console.error('load leave schedule failed', error)
      const nameByProfile = new Map((nameRows ?? []).map((r) => [r.profile_id, r.roster_display_name]))
      setLeaves(
        (data ?? []).map((l) => ({
          ...l,
          profiles: l.profiles ? { ...l.profiles, roster_display_name: nameByProfile.get(l.profile_id) } : l.profiles,
        }))
      )
      setLoading(false)
    })
  }, [currentStoreId, viewYear, viewMonth])

  function goToMonth(delta) {
    const next = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  // One row per employee who has at least one leave period touching this
  // month, so their bar(s) and name always line up together instead of
  // several people's bars competing for the same row.
  const rows = useMemo(() => {
    const byProfile = new Map()
    leaves.forEach((l) => {
      const key = l.profile_id
      if (!byProfile.has(key)) {
        const name = l.profiles ? rosterDisplayName(l.profiles) : 'Unknown'
        byProfile.set(key, { profileId: key, name, entries: [] })
      }
      byProfile.get(key).entries.push(l)
    })
    return Array.from(byProfile.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [leaves])

  return (
    <div>
      {/* One row, always — year first (left) then month (right), on both
          desktop and mobile. Widths are `!`-forced because the shared
          `.input` class sets width:100% outside any Tailwind layer, so a
          plain `w-*` utility loses to it (same reason other screens in
          this app — e.g. UserManagementPage's Link-to select — use `!w-*`
          on an `.input` too); fixed, non-responsive widths just wide
          enough for "2026" / "September" plus a little breathing room, so
          this always fits one line instead of forcing the page to scroll
          sideways to reach the ›  button. */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => goToMonth(-1)}
          className="shrink-0 rounded-md border border-brand-200 px-2 py-1 text-sm text-brand-600 hover:bg-brand-50"
        >
          ‹
        </button>
        <select className="input !w-20 shrink-0" value={viewYear} onChange={(e) => setViewYear(Number(e.target.value))}>
          {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select className="input !w-32 shrink-0" value={viewMonth} onChange={(e) => setViewMonth(Number(e.target.value))}>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <button
          onClick={() => goToMonth(1)}
          className="shrink-0 rounded-md border border-brand-200 px-2 py-1 text-sm text-brand-600 hover:bg-brand-50"
        >
          ›
        </button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !rows.length ? (
        <EmptyState label="No leave scheduled this month." />
      ) : (
        <>
          {/* Desktop/tablet: unchanged horizontal timeline (day-of-month
              across, one row per employee). */}
          <div className="hidden sm:block">
            <MonthTimelineView rows={rows} year={viewYear} month={viewMonth} daysInMonth={daysInMonth} />
          </div>
          {/* Mobile: a full week's worth of horizontal scrolling to see one
              bar was awkward to operate, so this is the same idea rotated —
              day-of-month runs top-to-bottom (only needs vertical scroll,
              which a phone already does naturally) and each employee gets a
              narrow vertical column instead of a wide horizontal row. */}
          <div className="sm:hidden">
            <MonthTimelineViewMobile rows={rows} year={viewYear} month={viewMonth} daysInMonth={daysInMonth} />
          </div>
        </>
      )}
    </div>
  )
}

// Days-of-month header + one horizontal bar per employee, each leave period
// drawn as a colored segment positioned/sized by the calendar dates it
// covers, labelled with the employee's name — a shape/position at a glance
// instead of reading every leave's start/end date as text. Hovering a
// segment shows the exact (unclipped) date range via the browser's native
// tooltip (the `title` attribute on the bar) — just the one popup, no
// second custom-styled box under it.
function MonthTimelineView({ rows, year, month, daysInMonth }) {
  const dayWidth = 28 // px per day, so a full month stays readable and horizontally scrollable on narrow screens
  const nameColWidth = 140 // matches the name column's rendered width closely enough to size the scroll area

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-100 bg-white p-4">
      <div style={{ minWidth: `${nameColWidth + daysInMonth * dayWidth}px` }}>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="w-20 shrink-0 sm:w-32" />
          <div className="relative h-4 flex-1 text-[10px] text-gray-400">
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
              <span key={d} className="absolute -translate-x-1/2" style={{ left: `${((d - 0.5) / daysInMonth) * 100}%` }}>
                {d}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.profileId} className="flex items-center gap-2">
              {/* Sticky, not just fixed-width — so scrolling right on a
                  narrow phone screen to see later-in-the-month bars never
                  scrolls the employee's name out of view along with it. */}
              <span
                className="sticky left-0 z-10 w-20 shrink-0 truncate bg-white text-xs font-medium text-gray-500 sm:w-32"
                title={row.name}
              >
                {row.name}
              </span>
              <div className="relative h-8 flex-1 rounded-md border border-gray-200 bg-gray-50">
                {Array.from({ length: daysInMonth - 1 }, (_, i) => i + 1).map((d) => (
                  <div key={d} className="absolute top-0 bottom-0 border-l border-gray-200" style={{ left: `${(d / daysInMonth) * 100}%` }} />
                ))}
                {row.entries.map((entry) => (
                  <LeaveBar key={entry.id} entry={entry} name={row.name} year={year} month={month} daysInMonth={daysInMonth} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LeaveBar({ entry, name, year, month, daysInMonth }) {
  // The bar is always drawn at day granularity (even for a leave with a
  // specific time) — leaveDisplayDates gives the calendar days it touches;
  // leaveTooltipLabel separately decides whether to also show a time.
  const { startDate: trueStart, endDate: trueEnd } = leaveDisplayDates(entry)
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month, daysInMonth)

  // Clip the drawn bar to this visible month — a leave that starts last
  // month or continues into next month still shows the part that falls in
  // this one — but the hover tooltip always shows the true, unclipped dates.
  const clippedStart = trueStart < monthStart ? monthStart : trueStart
  const clippedEnd = trueEnd > monthEnd ? monthEnd : trueEnd
  if (clippedEnd < clippedStart) return null

  const startDayIdx = clippedStart.getDate() - 1
  const endDayIdx = clippedEnd.getDate() - 1
  const leftPct = (startDayIdx / daysInMonth) * 100
  const widthPct = ((endDayIdx - startDayIdx + 1) / daysInMonth) * 100
  const continuesBefore = trueStart < monthStart
  const continuesAfter = trueEnd > monthEnd
  const color = colorForName(name)

  // Browser-native tooltip only — name, date range, and the reason (if any),
  // all in this one string, since there's no custom box to show it in.
  const rangeLabel = leaveTooltipLabel(entry)
  const tooltip = `${name}: ${rangeLabel}${entry.reason ? ` — ${entry.reason}` : ''}`

  return (
    <div
      className="absolute top-0.5 bottom-0.5 flex cursor-default items-center overflow-hidden px-1.5"
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        minWidth: '10px',
        backgroundColor: color,
        borderTopLeftRadius: continuesBefore ? 0 : 6,
        borderBottomLeftRadius: continuesBefore ? 0 : 6,
        borderTopRightRadius: continuesAfter ? 0 : 6,
        borderBottomRightRadius: continuesAfter ? 0 : 6,
      }}
      title={tooltip}
    >
      <span className="truncate text-[11px] font-semibold text-white">{name}</span>
    </div>
  )
}

// Mobile version of the same idea, rotated: day-of-month runs down instead
// of across, and each employee gets a narrow vertical column instead of a
// wide horizontal row — only vertical scrolling is ever needed, which a
// phone already does naturally, instead of horizontal scrolling to line a
// bar up against a day header far off to the side.
//
// A phone has no hover, so a tap can't rely on the native `title` tooltip
// the desktop view uses — tapping a bar instead shows the same name/date
// (time)/reason details in a small panel below the grid.
function MonthTimelineViewMobile({ rows, year, month, daysInMonth }) {
  const dayHeight = 18 // px per day
  const colWidth = 72 // px per employee column
  const rulerWidth = 24 // px for the day-of-month numbers down the left
  const totalHeight = daysInMonth * dayHeight
  const [activeEntry, setActiveEntry] = useState(null)

  // A tapped leave's month may no longer be the one on screen after
  // switching months — drop the open detail panel rather than showing
  // stale info for an entry that isn't even drawn anymore.
  useEffect(() => {
    setActiveEntry(null)
  }, [year, month])

  // Tapping anywhere else — another tab, the month picker, empty space,
  // even outside this component entirely — closes the detail panel, same
  // as tapping the open bar again would. Checking the click's target
  // (rather than stopping propagation on the bar) is what makes this catch
  // every kind of "somewhere else", not just clicks inside this widget.
  useEffect(() => {
    if (!activeEntry) return
    function closeOnOutsideClick(e) {
      if (e.target.closest?.('[data-leave-bar]')) return // the bar's own onTap already handles this click
      setActiveEntry(null)
    }
    document.addEventListener('click', closeOnOutsideClick)
    return () => document.removeEventListener('click', closeOnOutsideClick)
  }, [activeEntry])

  return (
    <div className="rounded-xl border border-brand-100 bg-white p-3">
      <div className="overflow-x-auto">
        <div className="flex" style={{ minWidth: `${rulerWidth + rows.length * colWidth}px` }}>
          {/* Sticky, same trick as the desktop view's sticky name column —
              scrolling right to see more employees never scrolls the day
              numbers out of view along with it. */}
          <div className="sticky left-0 z-10 shrink-0 bg-white" style={{ width: `${rulerWidth}px` }}>
            <div className="h-5" />
            <div className="relative" style={{ height: `${totalHeight}px` }}>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <span
                  key={d}
                  className="absolute right-1 -translate-y-1/2 text-[9px] text-gray-400"
                  style={{ top: `${((d - 0.5) / daysInMonth) * 100}%` }}
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
          {rows.map((row) => (
            <div key={row.profileId} className="shrink-0 border-l border-gray-100 px-1" style={{ width: `${colWidth}px` }}>
              <div className="relative rounded-md border border-gray-200 bg-gray-50" style={{ height: `${totalHeight}px` }}>
                {Array.from({ length: daysInMonth - 1 }, (_, i) => i + 1).map((d) => (
                  <div key={d} className="absolute left-0 right-0 border-t border-gray-200" style={{ top: `${(d / daysInMonth) * 100}%` }} />
                ))}
                {row.entries.map((entry) => (
                  <VerticalLeaveBar
                    key={entry.id}
                    entry={entry}
                    name={row.name}
                    year={year}
                    month={month}
                    daysInMonth={daysInMonth}
                    active={activeEntry?.id === entry.id}
                    onTap={() => setActiveEntry((cur) => (cur?.id === entry.id ? null : { ...entry, name }))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {activeEntry && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs">
          <div className="font-semibold text-gray-800">{activeEntry.name}</div>
          <div className="mt-0.5 text-gray-500">{leaveTooltipLabel(activeEntry)}</div>
          {activeEntry.reason && <div className="mt-0.5 text-gray-400">{activeEntry.reason}</div>}
        </div>
      )}
    </div>
  )
}

function VerticalLeaveBar({ entry, name, year, month, daysInMonth, active, onTap }) {
  const { startDate: trueStart, endDate: trueEnd } = leaveDisplayDates(entry)
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month, daysInMonth)

  const clippedStart = trueStart < monthStart ? monthStart : trueStart
  const clippedEnd = trueEnd > monthEnd ? monthEnd : trueEnd
  if (clippedEnd < clippedStart) return null

  const startDayIdx = clippedStart.getDate() - 1
  const endDayIdx = clippedEnd.getDate() - 1
  const topPct = (startDayIdx / daysInMonth) * 100
  const heightPct = ((endDayIdx - startDayIdx + 1) / daysInMonth) * 100
  const continuesBefore = trueStart < monthStart
  const continuesAfter = trueEnd > monthEnd
  const color = colorForName(name)

  return (
    <div
      role="button"
      tabIndex={0}
      // Marks this as a bar for the outside-click-closes-the-panel listener
      // in MonthTimelineViewMobile — that listener skips anything inside a
      // `[data-leave-bar]`, since tapping a bar (below) already decides the
      // panel's next state itself.
      data-leave-bar="true"
      onClick={onTap}
      onKeyDown={(e) => e.key === 'Enter' && onTap()}
      className="absolute left-0.5 right-0.5 flex cursor-pointer items-start justify-center overflow-hidden pt-0.5"
      style={{
        top: `${topPct}%`,
        height: `${heightPct}%`,
        minHeight: '10px',
        backgroundColor: color,
        borderTopLeftRadius: continuesBefore ? 0 : 6,
        borderTopRightRadius: continuesBefore ? 0 : 6,
        borderBottomLeftRadius: continuesAfter ? 0 : 6,
        borderBottomRightRadius: continuesAfter ? 0 : 6,
        boxShadow: active ? '0 0 0 2px #1f2937' : 'none',
      }}
    >
      <span className="truncate text-[9px] font-semibold leading-tight text-white">{name}</span>
    </div>
  )
}
