// Shared date/time handling for Leave Management (Apply, Edit, Schedule),
// so all three stay in sync on one definition of "all-day" vs
// "specific-time" leave instead of each re-deriving it slightly differently.
//
// Applying leave defaults to picking dates only (no time) — most leave is
// whole days. Checking "Specify time" reveals start/end time pickers,
// restricted to half-hour steps (no minutes, no seconds) via the
// HALF_HOUR_TIMES option list below rather than a free-typed time input.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

export function formatTimeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function toDateInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayDateInput() {
  return toDateInput(new Date())
}

export function addDaysToDateInput(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return toDateInput(new Date(y, m - 1, d + days))
}

// Builds the timestamptz pair actually stored. All-day leave is stored as a
// half-open [start-date 00:00, end-date+1 00:00) range — so a single day
// still has real duration, and it overlaps months/queries the same simple
// way a timed leave does (start < window end, end > window start).
export function buildLeaveTimestamps({ startDate, endDate, includeTime, startTime, endTime }) {
  if (!includeTime) {
    return {
      start_at: `${startDate}T00:00:00`,
      end_at: `${addDaysToDateInput(endDate, 1)}T00:00:00`,
      has_time: false,
    }
  }
  return {
    start_at: `${startDate}T${startTime}:00`,
    end_at: `${endDate}T${endTime}:00`,
    has_time: true,
  }
}

// Reverses buildLeaveTimestamps, to pre-fill the Edit form from a stored row.
export function parseLeaveTimestamps(startAtRaw, endAtRaw, hasTime) {
  const start = new Date(startAtRaw)
  const end = new Date(endAtRaw)
  const pad = (n) => String(n).padStart(2, '0')
  if (!hasTime) {
    return {
      startDate: toDateInput(start),
      endDate: addDaysToDateInput(toDateInput(end), -1),
      includeTime: false,
      startTime: '09:00',
      endTime: '17:00',
    }
  }
  return {
    startDate: toDateInput(start),
    startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    endDate: toDateInput(end),
    endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
    includeTime: true,
  }
}

function dateOnlyLabel(d) {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

// The calendar dates a leave visually spans, for positioning it on the
// Leave Schedule month timeline — always day-granularity even when the
// underlying leave has specific times.
export function leaveDisplayDates(entry) {
  const start = new Date(entry.start_at)
  const end = new Date(entry.end_at)
  const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  // An all-day leave's stored end is the exclusive next-day boundary, so its
  // real last day is one day earlier; a timed leave's end is a real instant.
  const endDate = entry.has_time
    ? new Date(end.getFullYear(), end.getMonth(), end.getDate())
    : new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
  return { startDate, endDate }
}

// Hover-tooltip text on the Schedule timeline: date only when the leave has
// no specific time, date+time when it does.
export function leaveTooltipLabel(entry) {
  const { startDate, endDate } = leaveDisplayDates(entry)
  if (!entry.has_time) {
    return startDate.getTime() === endDate.getTime() ? dateOnlyLabel(startDate) : `${dateOnlyLabel(startDate)} – ${dateOnlyLabel(endDate)}`
  }
  const start = new Date(entry.start_at)
  const end = new Date(entry.end_at)
  const pad = (n) => String(n).padStart(2, '0')
  const withTime = (d) => `${dateOnlyLabel(d)}, ${formatTimeLabel(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`
  return `${withTime(start)} – ${withTime(end)}`
}
