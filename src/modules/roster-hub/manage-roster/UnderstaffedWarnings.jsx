import { parseISO } from 'date-fns'
import { timeToDecimal } from '../../../lib/excelRoster'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Jeff, 2026-10-01: "understaffed slots平常不顯示，在按Save和Submit才跳出視
// 窗提示，但還是可以繼續儲存跟發布" — this used to render inline under the
// grid any time it applied; now ManageRosterPage.jsx only runs this
// calculation right when Save/Submit is clicked, and shows whatever it
// finds in a confirm popup (Cancel, or continue with the save/publish
// anyway — a soft warning, not a block) instead of a banner on the page
// itself. Split into a pure calculation (this function — no UI, easy to
// call from an event handler) and a plain list renderer (the component
// below — no more its own "am I even relevant" early-return, since the
// caller now only mounts it once it already knows there's something to
// show, inside its own Modal).
//
// Jeff, 2026-10-03 (found while testing locally): "toowong禮拜天下午2點之後只
// 有一個人，按save也沒提示人力不夠" — root cause was this function counting
// how many SHIFTS merely overlap a rule's time slot at all, not how many
// people are actually on the floor AT THE SAME TIME within it. A rule
// spanning a wide block (e.g. Toowong's "Sunday open to close", 10:00-17:45,
// needs 2) with a shift handoff partway through — Shirley 09:30-17:45 +
// Arianna 10:00-14:00 — used to come back as count=2 (both shifts touch the
// slot) and never flag, even though only Shirley is actually there after
// 2pm. Fixed to sweep the slot for its worst moment instead: clip every
// overlapping shift to the slot's own bounds, walk the resulting breakpoints
// (shift starts/ends plus the slot's own start/end), and take the minimum
// number of people covering any sub-interval between them — that's the
// true "fewest on the floor at once" figure a staffing minimum is actually
// meant to guard, not a simple headcount of who clocks in at some point
// during the slot.
function minConcurrentCoverage(intervals, slotStart, slotEnd) {
  if (slotEnd <= slotStart) return 0
  const points = new Set([slotStart, slotEnd])
  intervals.forEach(([s, e]) => {
    points.add(s)
    points.add(e)
  })
  const sorted = Array.from(points).sort((a, b) => a - b)
  let min = Infinity
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i]
    const segEnd = sorted[i + 1]
    if (segEnd <= segStart) continue
    const mid = (segStart + segEnd) / 2
    const covering = intervals.filter(([s, e]) => s <= mid && e >= mid).length
    min = Math.min(min, covering)
  }
  return min === Infinity ? 0 : min
}

// Entries store Start/End as decimal hours (see excelRoster.js); rules
// store their time slot as "HH:MM:SS" from the database, so slot bounds are
// converted to decimal hours here before comparing/clipping.
export function computeUnderstaffedWarnings(entries, rules) {
  if (!rules.length) return []
  return rules
    .map((rule) => {
      const slotStart = timeToDecimal(rule.time_slot_start)
      const slotEnd = timeToDecimal(rule.time_slot_end)
      const intervals = entries
        .filter((e) => {
          if (!e.date || e.startTime === '' || e.endTime === '') return false
          const weekday = parseISO(e.date).getDay()
          if (weekday !== rule.weekday) return false
          return e.startTime < slotEnd && e.endTime > slotStart
        })
        .map((e) => [Math.max(e.startTime, slotStart), Math.min(e.endTime, slotEnd)])
      const count = minConcurrentCoverage(intervals, slotStart, slotEnd)
      return { ...rule, count }
    })
    .filter((r) => r.count < r.required_min)
}

// Plain list of already-computed warnings — no Modal of its own; the
// caller (ManageRosterPage.jsx) wraps this in its own confirm popup.
export default function UnderstaffedWarnings({ warnings }) {
  if (!warnings.length) return null

  return (
    <ul className="list-inside list-disc space-y-0.5 text-sm text-amber-800">
      {warnings.map((w) => (
        <li key={w.id}>
          {WEEKDAY_LABELS[w.weekday]} {w.time_slot_label}: as few as {w.count} on at once, needs {w.required_min}
          {' '}
          (target: {w.required_counts_raw})
        </li>
      ))}
    </ul>
  )
}
