import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { pairEventsIntoSessions, dailyTotals } from '../../../lib/attendance'

// Jeff, 2026-09: the x-axis used to be calendar days since hire — but a
// 2-day-a-week part-timer and a full-timer shouldn't be held to the same
// calendar clock, so it's now cumulative HOURS WORKED (from attendance
// logs) instead. Same idea, fairer yardstick.
const MIN_WINDOW_HOURS = 120 // a bit past the 100h target so the ramp's flat tail is always visible, even for a brand-new hire with 0h so far
const PX_PER_HOUR = 7
const CHART_HEIGHT = 220
const PAD_LEFT = 44
const PAD_BOTTOM = 32
const PAD_TOP = 16
const PAD_RIGHT = 16
// Jeff's target pace: fully memorized by 100 hours worked (the same 100h
// standard the Formal Quiz reminder and Learning Tracker's 70h warning are
// both built around) — drawn as a straight reference line from (0h, 0
// items) to (100h, all items), flat afterwards.
const TARGET_HOURS = 100
const AVG_LINE_COLOR = '#3b82f6' // blue — distinct from the orange actual-progress line and the orange "now" marker

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function dateKey(d) {
  return startOfDay(d).toISOString().slice(0, 10)
}

// Fritsch–Carlson monotone cubic Hermite spline, converted to SVG cubic
// Bezier segments — Jeff asked for a smooth curve instead of the sharp
// "one straight segment per memorized item" line this used to draw (a day
// with several items memorized at once made it look like a staircase).
// This specific spline (rather than a plain Catmull-Rom smoothing) is
// chosen because the data is a running total that only ever goes up or
// stays flat — a spline that doesn't preserve monotonicity can curve
// slightly below a point or overshoot above the next one between two
// samples, which would misleadingly show the count dipping or exceeding
// what was actually memorized at that moment. `points` must already be
// sorted ascending by x with strictly increasing x (no two points sharing
// the same x — see the same-x merge below, before this is called).
function monotonePath(points, xScale, yScale) {
  const n = points.length
  if (n < 2) return ''
  const xs = points.map(([x]) => xScale(x))
  const ys = points.map(([, count]) => yScale(count))
  const segCount = n - 1
  const slope = new Array(segCount)
  for (let i = 0; i < segCount; i++) {
    slope[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])
  }
  const tangent = new Array(n)
  tangent[0] = slope[0]
  tangent[n - 1] = slope[segCount - 1]
  for (let i = 1; i < n - 1; i++) {
    // A flat spot, or a direction change (never happens for this
    // non-decreasing data, but kept for safety) gets a flat tangent —
    // otherwise the average of the two neighboring segment slopes.
    tangent[i] = slope[i - 1] === 0 || slope[i] === 0 || slope[i - 1] < 0 !== slope[i] < 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  }
  // Fritsch-Carlson correction so the curve can never overshoot past a
  // segment's own two endpoint values.
  for (let i = 0; i < segCount; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0
      tangent[i + 1] = 0
      continue
    }
    const alpha = tangent[i] / slope[i]
    const beta = tangent[i + 1] / slope[i]
    const h = Math.hypot(alpha, beta)
    if (h > 3) {
      const tau = 3 / h
      tangent[i] = tau * alpha * slope[i]
      tangent[i + 1] = tau * beta * slope[i]
    }
  }
  let path = `M ${xs[0]} ${ys[0]}`
  for (let i = 0; i < segCount; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3
    path += ` C ${xs[i] + dx} ${ys[i] + tangent[i] * dx}, ${xs[i + 1] - dx} ${ys[i + 1] - tangent[i + 1] * dx}, ${xs[i + 1]} ${ys[i + 1]}`
  }
  return path
}

// x = cumulative hours worked (per attendance_events) as of each day an
// item was marked "Memorized" in Study Log, y = cumulative count of
// formula items memorized. Qualified staff (see StudyLogList's `qualified`
// prop) count every active item as memorized automatically from day one, so
// there's no real event history for them — just a flat line at the top.
export default function ProgressChartModal({ profileId, onClose }) {
  const [loading, setLoading] = useState(true)
  const [hireDate, setHireDate] = useState(null)
  const [usedFallbackDate, setUsedFallbackDate] = useState(false)
  const [isQualified, setIsQualified] = useState(false)
  const [totalItems, setTotalItems] = useState(0)
  const [events, setEvents] = useState([]) // ascending memorized_at Dates
  const [dailyMinutes, setDailyMinutes] = useState({}) // 'yyyy-MM-dd' -> minutes worked that day

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    Promise.all([
      supabase.from('profiles').select('hire_date, qualified, created_at').eq('id', profileId).single(),
      supabase.from('formula_items').select('id').eq('is_active', true),
      supabase
        .from('study_progress')
        .select('memorized_at')
        .eq('profile_id', profileId)
        .eq('memorized', true)
        .not('memorized_at', 'is', null)
        .order('memorized_at'),
      supabase.from('attendance_events').select('*').eq('profile_id', profileId),
    ]).then(([{ data: p }, { data: items }, { data: progress }, { data: attendanceRows }]) => {
      setHireDate(p?.hire_date ?? p?.created_at ?? null)
      setUsedFallbackDate(!p?.hire_date && !!p?.created_at)
      setIsQualified(!!p?.qualified)
      setTotalItems(items?.length ?? 0)
      setEvents((progress ?? []).map((r) => new Date(r.memorized_at)))
      setDailyMinutes(dailyTotals(pairEventsIntoSessions(attendanceRows ?? [])))
      setLoading(false)
    })
  }, [profileId])

  const chart = useMemo(() => {
    if (!hireDate) return null

    // Cumulative hours worked as of the end of any given day — built once
    // from the daily totals above, looked up by whichever day each
    // memorized event fell on. A day with no attendance record at all
    // (someone memorized an item without having clocked in that day, or a
    // shift from before migration 0054 introduced attendance logging) just
    // isn't in this list, so it falls through to "as of the most recent
    // earlier day with hours on record" below — never treated as an error.
    const sortedDates = Object.keys(dailyMinutes).sort()
    let running = 0
    const cumByDate = sortedDates.map((d) => {
      running += dailyMinutes[d]
      return [d, running]
    })
    const totalMinutesWorked = running
    const hoursSoFar = totalMinutesWorked / 60

    function hoursThrough(dStr) {
      let result = 0
      for (const [d, cumMinutes] of cumByDate) {
        if (d > dStr) break
        result = cumMinutes
      }
      return result / 60
    }

    const windowHours = Math.max(MIN_WINDOW_HOURS, hoursSoFar)
    const width = PAD_LEFT + PAD_RIGHT + windowHours * PX_PER_HOUR
    const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM

    const maxCount = Math.max(1, isQualified ? totalItems : Math.max(totalItems, events.length))

    const points = []
    if (isQualified) {
      points.push([0, totalItems], [hoursSoFar, totalItems])
    } else {
      // First fold same-CALENDAR-DAY events into one point per day (last
      // count that day wins) — same as before — then map each day to its
      // cumulative-hours x-value and fold AGAIN wherever two different days
      // land on the same x (a stretch with no attendance hours in between,
      // e.g. a day someone ticked "Memorized" from home without clocking
      // in) — monotonePath below requires strictly increasing x, and
      // without this second fold a flat attendance gap would divide by
      // zero in its slope calculation.
      let count = 0
      const byDay = []
      byDay.push(['', 0]) // hire-side anchor, mapped to hoursThrough('') = 0 below
      events.forEach((e) => {
        const day = dateKey(e)
        count += 1
        const last = byDay[byDay.length - 1]
        if (last[0] === day) {
          last[1] = count
        } else {
          byDay.push([day, count])
        }
      })
      const todayKey = dateKey(new Date())
      const lastDay = byDay[byDay.length - 1]
      if (lastDay[0] !== todayKey) byDay.push([todayKey, count])

      byDay.forEach(([day, c]) => {
        const x = day === '' ? 0 : hoursThrough(day)
        const last = points[points.length - 1]
        if (last && last[0] === x) {
          last[1] = c
        } else {
          points.push([x, c])
        }
      })
    }

    const xScale = (hours) => PAD_LEFT + hours * PX_PER_HOUR
    const yScale = (count) => PAD_TOP + plotHeight - (count / maxCount) * plotHeight
    const path = points.length < 2 ? '' : monotonePath(points, xScale, yScale)

    // Average learning curve: a straight ramp from (0h, 0) to (100h,
    // totalItems), then flat at totalItems for the rest of the window —
    // "you should be fully memorized by 100 hours worked" as a reference
    // line to compare the actual (orange) progress line against.
    const avgPoints = [[0, 0], [TARGET_HOURS, totalItems]]
    if (windowHours > TARGET_HOURS) avgPoints.push([windowHours, totalItems])
    const avgPath = avgPoints.map(([h, c], i) => `${i === 0 ? 'M' : 'L'} ${xScale(h)} ${yScale(c)}`).join(' ')

    // Gridlines/labels every 20 hours, out to the right edge.
    const ticks = []
    for (let h = 0; xScale(h) <= width - PAD_RIGHT + 1; h += 20) {
      ticks.push({ hour: h, label: `${h}h` })
    }

    return {
      width,
      plotHeight,
      maxCount,
      points,
      path,
      avgPath,
      xScale,
      yScale,
      ticks,
      hoursSoFar,
      memorizedNow: isQualified ? totalItems : events.length,
    }
  }, [hireDate, isQualified, totalItems, events, dailyMinutes])

  return (
    <Modal open onClose={onClose} extraWide title="📈 Progress Chart">
      {loading ? (
        <LoadingSpinner />
      ) : !chart ? (
        <EmptyState label="No hire date on file yet — ask a manager to set it in Staff Information." />
      ) : (
        <div>
          <p className="mb-2 text-sm text-gray-500">
            Formula items memorized against hours worked (from attendance logs) since hire date (
            {new Date(hireDate).toLocaleDateString()}
            {usedFallbackDate ? ' — no hire date on file, using account creation date instead' : ''}).
          </p>
          {!isQualified && chart.hoursSoFar === 0 && events.length > 0 && (
            <p className="mb-2 text-xs text-amber-600">
              No attendance logs on file yet for this person — hours worked can't be calculated, so every memorized
              item shows at 0h below until a clock-in/out is on record.
            </p>
          )}
          <div className="mb-2 flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded bg-[#ea580c]" /> Memorized items
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ background: `repeating-linear-gradient(90deg, ${AVG_LINE_COLOR} 0 4px, transparent 4px 7px)` }}
              />
              Average learning curve (100 hours)
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-brand-100 bg-white">
            <svg width={chart.width} height={CHART_HEIGHT} className="block">
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <g key={f}>
                  <line
                    x1={PAD_LEFT}
                    x2={chart.width - PAD_RIGHT}
                    y1={PAD_TOP + chart.plotHeight * (1 - f)}
                    y2={PAD_TOP + chart.plotHeight * (1 - f)}
                    stroke="#ffedd5"
                  />
                  <text x={PAD_LEFT - 8} y={PAD_TOP + chart.plotHeight * (1 - f) + 4} textAnchor="end" fontSize="10" fill="#9ca3af">
                    {Math.round(chart.maxCount * f)}
                  </text>
                </g>
              ))}
              {chart.ticks.map((t) => (
                <g key={t.hour}>
                  <line x1={chart.xScale(t.hour)} x2={chart.xScale(t.hour)} y1={PAD_TOP} y2={CHART_HEIGHT - PAD_BOTTOM} stroke="#fff7ed" />
                  <text x={chart.xScale(t.hour)} y={CHART_HEIGHT - PAD_BOTTOM + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">
                    {t.label}
                  </text>
                </g>
              ))}
              {/* "hours worked so far" marker */}
              <line
                x1={chart.xScale(chart.hoursSoFar)}
                x2={chart.xScale(chart.hoursSoFar)}
                y1={PAD_TOP}
                y2={CHART_HEIGHT - PAD_BOTTOM}
                stroke="#fb923c"
                strokeDasharray="3,3"
              />
              {/* Average learning curve — Jeff's 100-hour target pace, drawn
                  in a different color from the actual (orange) progress line
                  so the two are never mistaken for each other, plus a text
                  label right where it reaches the target. */}
              <path d={chart.avgPath} fill="none" stroke={AVG_LINE_COLOR} strokeWidth="1.5" strokeDasharray="5,4" />
              <text
                x={chart.xScale(TARGET_HOURS) + 4}
                y={chart.yScale(totalItems) - 6}
                fontSize="10"
                fill={AVG_LINE_COLOR}
              >
                Average learning curve
              </text>
              <path d={chart.path} fill="none" stroke="#ea580c" strokeWidth="2" />
              {chart.points.map(([h, c], i) => (
                <circle key={i} cx={chart.xScale(h)} cy={chart.yScale(c)} r="3" fill="#ea580c" />
              ))}
            </svg>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {isQualified
              ? 'Qualified staff — every item counts as memorized from day one.'
              : `${chart.memorizedNow} item${chart.memorizedNow === 1 ? '' : 's'} memorized so far · ${chart.hoursSoFar.toFixed(1)}h worked (dashed line = hours worked so far).`}
          </p>
        </div>
      )}
    </Modal>
  )
}
