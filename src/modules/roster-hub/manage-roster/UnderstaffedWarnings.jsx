import { parseISO } from 'date-fns'
import { timeToDecimal } from '../../../lib/excelRoster'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Counts how many entries overlap each staffing rule's time slot on the
// matching weekday, and flags any rule whose count is below its minimum.
// Entries store Start/End as decimal hours (see excelRoster.js); rules
// store their time slot as "HH:MM:SS" from the database, so slot bounds
// are converted to decimal hours here before comparing.
export default function UnderstaffedWarnings({ entries, rules }) {
  if (!rules.length) return null

  const warnings = rules
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

  if (!warnings.length) return null

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      <p className="mb-1 font-medium">Understaffed slots:</p>
      <ul className="list-inside list-disc space-y-0.5">
        {warnings.map((w) => (
          <li key={w.id}>
            {WEEKDAY_LABELS[w.weekday]} {w.time_slot_label}: {w.count} scheduled, needs {w.required_min}
            {' '}
            (target: {w.required_counts_raw})
          </li>
        ))}
      </ul>
    </div>
  )
}
