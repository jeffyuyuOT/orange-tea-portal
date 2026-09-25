// Shared logic for the per-store "how many people can be on leave at once"
// limit (Roster Hub > Setting > Leave limits) — kept in one place so Apply
// Leave's warning can't drift from however the limit is actually defined.

// Local calendar date key (YYYY-MM-DD) for a Date or ISO string, in the
// browser's own timezone — matches how the rest of the app already treats
// leave start/end (plain JS Date parsing of a datetime-local input's value,
// no explicit timezone conversion anywhere).
export function toDateKey(d) {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Every calendar day touched by [startISO, endISO) — end exclusive, since a
// leave request ending at 09:00 on the 5th doesn't put someone on leave for
// all of the 5th, only whatever's before 9am.
export function datesInRange(startISO, endISO) {
  const start = new Date(startISO)
  const end = new Date(endISO)
  if (isNaN(start) || isNaN(end) || end <= start) return []
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  const endIsExactMidnight = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0
  if (endIsExactMidnight && endDay > cursor) endDay.setDate(endDay.getDate() - 1)
  const dates = []
  const c = new Date(cursor)
  while (c <= endDay) {
    dates.push(toDateKey(c))
    c.setDate(c.getDate() + 1)
  }
  return dates
}

export function isWeekendDate(dateKey) {
  const day = new Date(`${dateKey}T00:00:00`).getDay()
  return day === 0 || day === 6
}

// The max allowed headcount on leave for one calendar day. A custom period
// covering that day wins over the weekday/weekend default (the most
// restrictive one, if more than one somehow overlaps); null means "no
// limit set" for that day, not zero.
export function maxAllowedForDate(dateKey, defaultsRow, periodRows) {
  const covering = (periodRows ?? []).filter((p) => dateKey >= p.start_date && dateKey <= p.end_date)
  if (covering.length) return Math.min(...covering.map((p) => p.max_count))
  if (!defaultsRow) return null
  return (isWeekendDate(dateKey) ? defaultsRow.weekend_max : defaultsRow.weekday_max) ?? null
}

// How many of `leaveRows` (each with start_at/end_at) cover the given day.
export function countOnDate(dateKey, leaveRows) {
  const dayStart = new Date(`${dateKey}T00:00:00`)
  const nextDay = new Date(dayStart)
  nextDay.setDate(nextDay.getDate() + 1)
  return leaveRows.filter((l) => new Date(l.start_at) < nextDay && new Date(l.end_at) > dayStart).length
}

// Scans [startISO, endISO) against the store's limits and existing leave —
// returns the first day that's already at capacity (so the applicant can't
// be added), or null if the whole range is fine.
export function findBlockedDate(startISO, endISO, defaultsRow, periodRows, existingLeaveRows) {
  for (const dateKey of datesInRange(startISO, endISO)) {
    const max = maxAllowedForDate(dateKey, defaultsRow, periodRows)
    if (max == null) continue
    if (countOnDate(dateKey, existingLeaveRows) >= max) return { dateKey, max }
  }
  return null
}
