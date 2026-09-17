import { parseISO } from 'date-fns'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Counts how many entries overlap each staffing rule's time slot on the
// matching weekday, and flags any rule whose count is below its minimum.
export default function UnderstaffedWarnings({ entries, rules }) {
  if (!rules.length) return null

  const warnings = rules
    .map((rule) => {
      const count = entries.filter((e) => {
        if (!e.date || !e.startTime || !e.endTime) return false
        const weekday = parseISO(e.date).getDay()
        if (weekday !== rule.weekday) return false
        return e.startTime < rule.time_slot_end && e.endTime > rule.time_slot_start
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
