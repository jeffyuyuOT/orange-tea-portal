import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'

const DAY_MS = 24 * 60 * 60 * 1000
// "at least 3 months" of x-axis window (Jeff's spec) — even a brand-new
// hire still gets a 90-day-wide chart, just mostly blank past today.
const MIN_WINDOW_DAYS = 90
// Wide enough that 90+ daily data points don't cram together — this is
// what actually satisfies "視窗要夠寬": the SVG itself is drawn this wide
// and the modal scrolls it horizontally (see the overflow-x-auto wrapper
// below) instead of squeezing it down to fit.
const PX_PER_DAY = 8
const CHART_HEIGHT = 220
const PAD_LEFT = 44
const PAD_BOTTOM = 32
const PAD_TOP = 16
const PAD_RIGHT = 16
// Jeff's target pace: everyone should have every active item memorized
// within 1.5 months of hire — drawn as a straight reference line from
// (day 0, 0 items) to (day TARGET_DAYS, all items), flat afterwards. Not
// tied to any per-store setting yet; if Jeff wants this adjustable later
// it can move into a settings table like leave limits/quiz settings.
const TARGET_MONTHS = 1.5
const TARGET_DAYS = Math.round(TARGET_MONTHS * 30)
const AVG_LINE_COLOR = '#3b82f6' // blue — distinct from the orange actual-progress line and the orange "today" marker

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// x = days since hire date, y = cumulative count of formula items marked
// "Memorized" in Study Log. Senior staff (see StudyLogList's `senior` prop)
// count every active item as memorized automatically from day one, so
// there's no real event history for them — just a flat line at the top.
export default function ProgressChartModal({ profileId, onClose }) {
  const [loading, setLoading] = useState(true)
  const [hireDate, setHireDate] = useState(null)
  const [usedFallbackDate, setUsedFallbackDate] = useState(false)
  const [isSenior, setIsSenior] = useState(false)
  const [totalItems, setTotalItems] = useState(0)
  const [events, setEvents] = useState([]) // ascending memorized_at Dates

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    Promise.all([
      supabase.from('profiles').select('hire_date, is_senior, created_at').eq('id', profileId).single(),
      supabase.from('formula_items').select('id').eq('is_active', true),
      supabase
        .from('study_progress')
        .select('memorized_at')
        .eq('profile_id', profileId)
        .eq('memorized', true)
        .not('memorized_at', 'is', null)
        .order('memorized_at'),
    ]).then(([{ data: p }, { data: items }, { data: progress }]) => {
      setHireDate(p?.hire_date ?? p?.created_at ?? null)
      setUsedFallbackDate(!p?.hire_date && !!p?.created_at)
      setIsSenior(!!p?.is_senior)
      setTotalItems(items?.length ?? 0)
      setEvents((progress ?? []).map((r) => new Date(r.memorized_at)))
      setLoading(false)
    })
  }, [profileId])

  const chart = useMemo(() => {
    if (!hireDate) return null
    const start = startOfDay(hireDate)
    const today = startOfDay(new Date())
    const daysSoFar = Math.max(0, Math.round((today - start) / DAY_MS))
    const windowDays = Math.max(MIN_WINDOW_DAYS, daysSoFar)
    const width = PAD_LEFT + PAD_RIGHT + windowDays * PX_PER_DAY
    const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM

    const maxCount = Math.max(1, isSenior ? totalItems : Math.max(totalItems, events.length))

    const points = []
    if (isSenior) {
      points.push([0, totalItems], [daysSoFar, totalItems])
    } else {
      let count = 0
      points.push([0, 0])
      events.forEach((e) => {
        const day = Math.max(0, Math.round((startOfDay(e) - start) / DAY_MS))
        count += 1
        points.push([day, count])
      })
      points.push([daysSoFar, count])
    }

    const xScale = (day) => PAD_LEFT + day * PX_PER_DAY
    const yScale = (count) => PAD_TOP + plotHeight - (count / maxCount) * plotHeight
    const path = points.map(([d, c], i) => `${i === 0 ? 'M' : 'L'} ${xScale(d)} ${yScale(c)}`).join(' ')

    // Average learning curve: a straight ramp from (0, 0) to (TARGET_DAYS,
    // totalItems), then flat at totalItems for the rest of the window —
    // "you should be fully memorized by day 45" as a reference line to
    // compare the actual (orange) progress line against.
    const avgPoints = [[0, 0], [TARGET_DAYS, totalItems]]
    if (windowDays > TARGET_DAYS) avgPoints.push([windowDays, totalItems])
    const avgPath = avgPoints.map(([d, c], i) => `${i === 0 ? 'M' : 'L'} ${xScale(d)} ${yScale(c)}`).join(' ')

    // Monthly gridlines/labels from hire date, out to the right edge.
    const ticks = []
    for (let m = 0; xScale(m * 30) <= width - PAD_RIGHT + 1; m += 1) {
      const tickDate = new Date(start.getTime() + m * 30 * DAY_MS)
      ticks.push({ day: m * 30, label: tickDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })
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
      daysSoFar,
      memorizedNow: isSenior ? totalItems : events.length,
    }
  }, [hireDate, isSenior, totalItems, events])

  return (
    <Modal open onClose={onClose} extraWide title="📈 Progress Chart">
      {loading ? (
        <LoadingSpinner />
      ) : !chart ? (
        <EmptyState label="No hire date on file yet — ask a manager to set it in Staff Information." />
      ) : (
        <div>
          <p className="mb-2 text-sm text-gray-500">
            Formula items memorized over time, since hire date ({new Date(hireDate).toLocaleDateString()}
            {usedFallbackDate ? ' — no hire date on file, using account creation date instead' : ''}).
          </p>
          <div className="mb-2 flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded bg-[#ea580c]" /> Memorized items
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ background: `repeating-linear-gradient(90deg, ${AVG_LINE_COLOR} 0 4px, transparent 4px 7px)` }}
              />
              Average learning curve ({TARGET_MONTHS} months)
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
                <g key={t.day}>
                  <line x1={chart.xScale(t.day)} x2={chart.xScale(t.day)} y1={PAD_TOP} y2={CHART_HEIGHT - PAD_BOTTOM} stroke="#fff7ed" />
                  <text x={chart.xScale(t.day)} y={CHART_HEIGHT - PAD_BOTTOM + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">
                    {t.label}
                  </text>
                </g>
              ))}
              {/* "today" marker */}
              <line
                x1={chart.xScale(chart.daysSoFar)}
                x2={chart.xScale(chart.daysSoFar)}
                y1={PAD_TOP}
                y2={CHART_HEIGHT - PAD_BOTTOM}
                stroke="#fb923c"
                strokeDasharray="3,3"
              />
              {/* Average learning curve — Jeff's 1.5-month target pace, drawn
                  in a different color from the actual (orange) progress line
                  so the two are never mistaken for each other, plus a text
                  label right where it reaches the target. */}
              <path d={chart.avgPath} fill="none" stroke={AVG_LINE_COLOR} strokeWidth="1.5" strokeDasharray="5,4" />
              <text
                x={chart.xScale(TARGET_DAYS) + 4}
                y={chart.yScale(totalItems) - 6}
                fontSize="10"
                fill={AVG_LINE_COLOR}
              >
                Average learning curve
              </text>
              <path d={chart.path} fill="none" stroke="#ea580c" strokeWidth="2" />
              {chart.points.map(([d, c], i) => (
                <circle key={i} cx={chart.xScale(d)} cy={chart.yScale(c)} r="3" fill="#ea580c" />
              ))}
            </svg>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {isSenior
              ? 'Senior staff — every item counts as memorized from day one.'
              : `${chart.memorizedNow} item${chart.memorizedNow === 1 ? '' : 's'} memorized so far · day ${chart.daysSoFar} since hire (dashed line = today).`}
          </p>
        </div>
      )}
    </Modal>
  )
}
