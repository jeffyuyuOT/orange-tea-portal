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
// Counts how many entries overlap each staffing rule's time slot on the
// matching weekday, and flags any rule whose count is below its minimum.
// Entries store Start/End as decimal hours (see excelRoster.js); rules
// store their time slot as "HH:MM:SS" from the database, so slot bounds
// are converted to decimal hours here before comparing.
export function computeUnderstaffedWarnings(entries, rules) {
  if (!rules.length) return []
  return rules
    .map((rule) => {
      const slotStart = timeToDecimal(rule.time_slot_start)
      const slotEnd = timeToDecimal(rule.time_slot_end)
      const count = entries.filter((e) => {
        if (!e.date || e.startTime === '' || e.endTime === '') return false
        const weekday = parseISO(e.date).getDay()
        if (weekday !== rule.weekday) return false
        return e.startTime < slotEnd && e.endTime > slotStart
      }).length
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
          {WEEKDAY_LABELS[w.weekday]} {w.time_slot_label}: {w.count} scheduled, needs {w.required_min}
          {' '}
          (target: {w.required_counts_raw})
        </li>
      ))}
    </ul>
  )
}
