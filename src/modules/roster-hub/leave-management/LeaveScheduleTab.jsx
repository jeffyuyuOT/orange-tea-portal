import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
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
    supabase
      .from('leave_requests')
      .select('*, profiles(first_name,last_name)')
      .eq('store_id', currentStoreId)
      .eq('status', 'active')
      .lt('start_at', monthEndExclusive.toISOString())
      .gt('end_at', monthStart.toISOString())
      .order('start_at')
      .then(({ data, error }) => {
        if (error) console.error('load leave schedule failed', error)
        setLeaves(data ?? [])
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
        const name = `${l.profiles?.first_name ?? ''} ${l.profiles?.last_name ?? ''}`.trim() || 'Unknown'
        byProfile.set(key, { profileId: key, name, entries: [] })
      }
      byProfile.get(key).entries.push(l)
    })
    return Array.from(byProfile.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [leaves])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => goToMonth(-1)}
          className="rounded-md border border-brand-200 px-2 py-1 text-sm text-brand-600 hover:bg-brand-50"
        >
          ‹
        </button>
        <select className="input w-36" value={viewMonth} onChange={(e) => setViewMonth(Number(e.target.value))}>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <select className="input w-24" value={viewYear} onChange={(e) => setViewYear(Number(e.target.value))}>
          {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          onClick={() => goToMonth(1)}
          className="rounded-md border border-brand-200 px-2 py-1 text-sm text-brand-600 hover:bg-brand-50"
        >
          ›
        </button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !rows.length ? (
        <EmptyState label="No leave scheduled this month." />
      ) : (
        <MonthTimelineView rows={rows} year={viewYear} month={viewMonth} daysInMonth={daysInMonth} />
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
