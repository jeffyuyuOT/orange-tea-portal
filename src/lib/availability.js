// My Availability (Roster Hub) — Jeff, 2026-09. Shared data model + logic
// for: MyAvailabilityPage.jsx (staff declaring their own hours), Manage
// Roster's "View Staff's Availability" modal, and RosterEntryGrid's
// shift-vs-availability warning. Keeping all of this in one place means
// those three call sites can never quietly disagree on what a day's
// declared availability actually means in minutes-since-midnight terms.
//
// Data model (migration 0063_staff_availability.sql): one `availability_days`
// row per (profile, calendar day) — absent entirely means "fully available,
// all day" (Jeff's explicit default). A present row's `mode` is one of:
//   'all_available'   — same as absent, but explicitly saved (rare; the
//                        save flow below actually deletes back to absent
//                        instead of writing this, but it's still a valid
//                        state to read, e.g. mid-edit before Save)
//   'all_unavailable' — no available time at all that day
//   'before'          — available from 00:00 up to `boundary_time`
//   'after'           — available from `boundary_time` to end of day
//   'custom'          — one or more explicit windows, in `availability_windows`
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from './supabaseClient'

export const AVAILABILITY_MODES = [
  { value: 'all_available', label: 'All day — Available' },
  { value: 'all_unavailable', label: 'All day — Unavailable' },
  { value: 'before', label: 'Available before…' },
  { value: 'after', label: 'Available after…' },
  { value: 'custom', label: 'Specific time range(s)' },
]

// 00:00 through 24:00 inclusive, every 15 minutes (97 options) — Jeff's
// spec ("每15分鐘一個單位") for every time picker this feature uses (the
// before/after boundary, and each custom window's start/end). A plain
// <select> rather than <input type="time" step="900"> because a native
// time input's step only shapes its spinner/picker UI, not what someone
// can actually type into it — this is the same reasoning Leave Management's
// HALF_HOUR_TIMES (leaveDates.js) already uses, just at a finer grain.
export const QUARTER_HOUR_TIMES = Array.from({ length: 97 }, (_, i) => {
  const totalMin = i * 15
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

export function formatQuarterHour(hhmm) {
  if (hhmm === '24:00') return '12:00 AM (end of day)'
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function timeToMinutes(hhmm) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

// Jeff, 2026-10-02: "選取after, before, 或specific time按save後，切換頁面再
// 回來時間都會變成12am" — the save itself was fine; this is a read-back bug.
// Postgres `time` columns round-trip as "HH:MM:SS", but every option in
// QUARTER_HOUR_TIMES (and now the hour/minute/AM-PM picker below) is
// "HH:MM" with no seconds — so the stored "14:00:00" never matched any
// option, and the browser silently fell back to rendering the first one
// ("00:00" / 12:00 AM). Stripping the seconds here, once, is what makes
// the saved value actually match an option again.
function stripSeconds(hhmmss) {
  return hhmmss ? hhmmss.slice(0, 5) : hhmmss
}

export const MINUTE_OPTIONS = ['00', '15', '30', '45']

// Jeff, 2026-10-02: "選時間的時候可以時分...分開選，這樣才不用像現在要選下午
// 要拉很長一段" — decompose/compose a "HH:MM" into/from separate hour(1-12)/
// minute(15-min)/AM-PM parts, so TimeOfDaySelect.jsx can offer three short
// pickers instead of one <select> with 97 entries to scroll through to
// reach an afternoon time.
//
// Jeff, 2026-10-02 (later): "系統所有填寫am/pm的部分不需要midnight (end of
// day)的選項，當天最晚能選的時間就是11:59pm" — dropped the special "24:00"/
// "midnight (end of day)" marker this used to decompose an empty value (or
// literal "24:00") into; a window now always ends by 11:45 PM at the
// latest (the last quarter-hour option TimeOfDaySelect.jsx offers), never
// a separate end-of-day marker. Confirmed no existing availability window
// or boundary time is actually stored as "24:00" before removing this, so
// nothing needed migrating.
export function decomposeQuarterHour(hhmm) {
  if (!hhmm) return { hour12: 12, minute: '00', ampm: 'AM' }
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return { hour12, minute: String(m).padStart(2, '0'), ampm }
}

export function composeQuarterHour(hour12, minute, ampm) {
  let h = Number(hour12) % 12
  if (ampm === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${minute}`
}

export function minutesToLabel(min) {
  const clamped = min >= 1440 ? 0 : min
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// A day's declared available windows, as [{ start, end }] in
// minutes-since-midnight (end can be 1440, meaning "through midnight") —
// the one shape everything else in this file and its callers works with.
// `dayRow` is an availability_days row (or undefined/null — "no row" is the
// default-available case), `windows` is that row's availability_windows
// children (only meaningful when mode === 'custom').
export function computeAvailableWindows(dayRow, windows = []) {
  if (!dayRow || dayRow.mode === 'all_available') return [{ start: 0, end: 1440 }]
  switch (dayRow.mode) {
    case 'all_unavailable':
      return []
    case 'before':
      return dayRow.boundary_time ? [{ start: 0, end: timeToMinutes(dayRow.boundary_time) }] : []
    case 'after':
      return dayRow.boundary_time ? [{ start: timeToMinutes(dayRow.boundary_time), end: 1440 }] : []
    case 'custom':
      return (windows ?? [])
        .filter((w) => w.start_time && w.end_time)
        .map((w) => ({ start: timeToMinutes(w.start_time), end: timeToMinutes(w.end_time) }))
        .filter((w) => w.end > w.start)
    default:
      return [{ start: 0, end: 1440 }]
  }
}

// Human-readable summary of a day's availability, for the "View Staff's
// Availability" list and any other read-only display.
export function describeDay(dayRow, windows = []) {
  const avail = computeAvailableWindows(dayRow, windows)
  if (!avail.length) return 'Unavailable'
  if (avail.length === 1 && avail[0].start === 0 && avail[0].end === 1440) return 'All day available'
  // Jeff, 2026-10-01: "顯示時間時，如果是before或after也寫before幾點或after
  // 幾點。因為譬如現在如果是after2pm會顯示2pm-12am，數字很多感覺很亂" -- a
  // 'before'/'after' day only ever produces the one window
  // computeAvailableWindows builds above (0..boundary, or boundary..1440) --
  // spelling that out as a from–to range just repeats what the mode already
  // says and, for 'after', always tacks on a not-actually-meaningful
  // "12:00 AM" at the end (1440 clamped back to midnight). Naming the mode
  // directly says the same thing with half the numbers. Multi-window
  // 'custom' days (and the default all-day case above) are unaffected.
  if (dayRow?.mode === 'before' && dayRow.boundary_time) return `Before ${minutesToLabel(timeToMinutes(dayRow.boundary_time))}`
  if (dayRow?.mode === 'after' && dayRow.boundary_time) return `After ${minutesToLabel(timeToMinutes(dayRow.boundary_time))}`
  return avail.map((w) => `${minutesToLabel(w.start)} – ${minutesToLabel(w.end)}`).join(', ')
}

function windowsOverlap(a, b) {
  return a.start < b.end && b.start < a.end
}

// The portion of one leave_requests row that falls on `dateStr`
// ('yyyy-MM-dd'), in minutes-since-midnight — or null if that leave doesn't
// touch this day at all. Mirrors leaveDates.js's day-granularity logic but
// keeps time-of-day (needed here; the Leave Schedule timeline only ever
// needed whole days). An all-day leave (has_time === false) blocks the
// entire day, same as leaveDisplayDates treats it.
export function leaveWindowOnDate(leave, dateStr) {
  const dayStart = new Date(`${dateStr}T00:00:00`)
  const nextDayStart = addDays(dayStart, 1)
  const leaveStart = new Date(leave.start_at)
  const leaveEnd = new Date(leave.end_at)
  if (leaveEnd <= dayStart || leaveStart >= nextDayStart) return null
  if (!leave.has_time) return { start: 0, end: 1440 }
  const clippedStart = leaveStart < dayStart ? dayStart : leaveStart
  const clippedEnd = leaveEnd > nextDayStart ? nextDayStart : leaveEnd
  return {
    start: Math.max(0, Math.round((clippedStart - dayStart) / 60000)),
    end: Math.min(1440, Math.round((clippedEnd - dayStart) / 60000)),
  }
}

// Every (day, available window, leave) triple that overlaps, across a whole
// week — MyAvailabilityPage's save-time validation ("填寫的availble time時
// 間會跟leave的時間做檢查...哪一個available時段跟leave登記時間重疊").
// `byDate` is { 'yyyy-MM-dd': { dayRow, windows } } for the week being
// saved; `leaves` is that profile's active leave_requests rows (any that
// might touch this week — callers fetch broadly and this does the actual
// day-by-day clipping).
export function findLeaveConflicts(byDate, leaves) {
  const conflicts = []
  Object.entries(byDate).forEach(([dateStr, { dayRow, windows }]) => {
    const avail = computeAvailableWindows(dayRow, windows)
    if (!avail.length) return
    ;(leaves ?? []).forEach((leave) => {
      const leaveWin = leaveWindowOnDate(leave, dateStr)
      if (!leaveWin) return
      avail.forEach((aw) => {
        if (windowsOverlap(aw, leaveWin)) conflicts.push({ dateStr, availWindow: aw, leaveWindow: leaveWin, leave })
      })
    })
  })
  return conflicts
}

// Subtracts one or more "blocking" windows (leave, in this file's only use
// so far) from a list of available windows, returning what's left — a
// window fully covered by a block disappears entirely; one only partly
// covered is clipped down to whatever portion the block didn't touch.
// Plain interval subtraction, applied one blocking window at a time.
function subtractWindows(avail, blockWindows) {
  let result = avail
  ;(blockWindows ?? []).forEach((b) => {
    const next = []
    result.forEach((w) => {
      if (!windowsOverlap(w, b)) {
        next.push(w)
        return
      }
      if (w.start < b.start) next.push({ start: w.start, end: b.start })
      if (w.end > b.end) next.push({ start: b.end, end: w.end })
    })
    result = next
  })
  return result
}

function formatWindows(avail) {
  if (!avail.length) return 'Unavailable'
  if (avail.length === 1 && avail[0].start === 0 && avail[0].end === 1440) return 'All day available'
  return avail.map((w) => `${minutesToLabel(w.start)} – ${minutesToLabel(w.end)}`).join(', ')
}

// Manage Roster's "View Staff's Availability" — same day description as
// describeDay, but with any leave that falls on this day cut out of the
// result first, leave always winning over whatever's declared. Jeff,
// 2026-10-02: "如果my availability勾選lock time pattern的員工，在遇到跟他請
// 假leave有衝突的時候，還是會以leave的為優先，所以my availability time頁面
// 顯示不變，但manager roster看staff's available time時會把leave的時間加上
// 去" — a staff member with "Lock time pattern" checked has their pattern
// auto-copied forward every week by a server-side cron job (see
// MyAvailabilityPage.jsx's comment) that never re-runs the save-time
// leave-conflict check a manual edit goes through, so their stored pattern
// can end up overlapping leave registered afterwards. Rather than making
// them unlock/edit My Availability just to clear that conflict, this is the
// one place that reconciles it for roster purposes — My Availability's own
// page (describeDay, findLeaveConflicts) is left showing the untouched
// pattern, on purpose.
export function describeDayWithLeave(dayRow, windows, leaveWindowsForDay) {
  const avail = computeAvailableWindows(dayRow, windows)
  const touchedByLeave = (leaveWindowsForDay ?? []).some((lw) => avail.some((aw) => windowsOverlap(aw, lw)))
  if (!touchedByLeave) return describeDay(dayRow, windows)
  return formatWindows(subtractWindows(avail, leaveWindowsForDay))
}

// Manage Roster's per-shift warning ("排時間的時候如果跟該員的available
// time有衝突的話...提示該時間不在該員的available time裡") — true if any
// part of the shift [startDecHour, endDecHour) (the same decimal-hour
// values RosterEntryGrid already works in, e.g. 9, 17.5) falls outside
// every available window for that day. Soft/overridable by design — this
// only answers the yes/no question, the caller decides what to do with it.
export function shiftConflictsWithAvailability(startDecHour, endDecHour, dayRow, windows = []) {
  const shiftStart = Math.round(startDecHour * 60)
  const shiftEnd = Math.round(endDecHour * 60)
  if (!(shiftEnd > shiftStart)) return false // no real shift entered yet — nothing to flag
  const avail = computeAvailableWindows(dayRow, windows)
  if (!avail.length) return true
  const sorted = [...avail].sort((a, b) => a.start - b.start)
  let cursor = shiftStart
  for (const w of sorted) {
    if (w.start > cursor) break
    if (w.end > cursor) cursor = w.end
    if (cursor >= shiftEnd) return false
  }
  return cursor < shiftEnd
}

// Every date in the 7-day week starting `weekStartStr` ('yyyy-MM-dd'),
// Monday through Sunday — same convention as ManageRosterPage's weekDates.
export function weekDatesFrom(weekStartStr) {
  return Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(weekStartStr), i), 'yyyy-MM-dd'))
}

// Converts one loaded day ({ dayRow, windows } — real DB rows, snake_case)
// into the in-progress edit shape MyAvailabilityPage's day editor actually
// works with: { mode, boundaryTime, windows: [{start,end}] }. Used both to
// seed the editor from what's already saved, and by "Copy last week" (which
// loads a *different* week via loadWeekAvailability and needs the same
// translation before it can drop into this week's edit state).
export function rowToEditDay({ dayRow, windows } = {}) {
  return {
    mode: dayRow?.mode ?? 'all_available',
    boundaryTime: stripSeconds(dayRow?.boundary_time) ?? '',
    windows: (windows ?? []).map((w) => ({ start: stripSeconds(w.start_time), end: stripSeconds(w.end_time) })),
  }
}

// The inverse of rowToEditDay — wraps one day's in-progress edit state back
// into the { dayRow, windows } shape computeAvailableWindows/
// findLeaveConflicts expect (as if it were a loaded row), so Save's
// leave-conflict check can validate the edits actually on screen rather than
// whatever was last saved.
export function editDayToRowShape(d) {
  return {
    dayRow: { mode: d.mode, boundary_time: d.boundaryTime || null },
    windows: (d.windows ?? []).map((w) => ({ start_time: w.start, end_time: w.end })),
  }
}

// Loads one profile's availability_days (+ child availability_windows) for
// one week, returned as { 'yyyy-MM-dd': { dayRow, windows } } with every
// one of the 7 days present (dayRow is null for a day with no saved row —
// the default-available case) — the shape every function above expects.
export async function loadWeekAvailability(profileId, weekStartStr) {
  const dates = weekDatesFrom(weekStartStr)
  const byDate = {}
  dates.forEach((d) => {
    byDate[d] = { dayRow: null, windows: [] }
  })
  if (!profileId) return byDate
  const { data: dayRows } = await supabase
    .from('availability_days')
    .select('*')
    .eq('profile_id', profileId)
    .eq('week_start_date', weekStartStr)
  const dayIds = (dayRows ?? []).map((d) => d.id)
  const { data: windowRows } = dayIds.length
    ? await supabase.from('availability_windows').select('*').in('availability_day_id', dayIds)
    : { data: [] }
  const windowsByDayId = {}
  ;(windowRows ?? []).forEach((w) => {
    ;(windowsByDayId[w.availability_day_id] ??= []).push(w)
  })
  ;(dayRows ?? []).forEach((row) => {
    if (byDate[row.entry_date]) byDate[row.entry_date] = { dayRow: row, windows: windowsByDayId[row.id] ?? [] }
  })
  return byDate
}

// Loads availability for several profiles at once, for one week — the
// "View Staff's Availability" modal's batch fetch, one round trip for the
// whole store instead of one per person. Returns { profileId: { 'yyyy-MM-dd': {dayRow, windows} } }.
export async function loadWeekAvailabilityForProfiles(profileIds, weekStartStr) {
  const dates = weekDatesFrom(weekStartStr)
  const result = {}
  profileIds.forEach((id) => {
    result[id] = {}
    dates.forEach((d) => {
      result[id][d] = { dayRow: null, windows: [] }
    })
  })
  if (!profileIds.length) return result
  const { data: dayRows } = await supabase
    .from('availability_days')
    .select('*')
    .in('profile_id', profileIds)
    .eq('week_start_date', weekStartStr)
  const dayIds = (dayRows ?? []).map((d) => d.id)
  const { data: windowRows } = dayIds.length
    ? await supabase.from('availability_windows').select('*').in('availability_day_id', dayIds)
    : { data: [] }
  const windowsByDayId = {}
  ;(windowRows ?? []).forEach((w) => {
    ;(windowsByDayId[w.availability_day_id] ??= []).push(w)
  })
  ;(dayRows ?? []).forEach((row) => {
    if (result[row.profile_id]?.[row.entry_date]) {
      result[row.profile_id][row.entry_date] = { dayRow: row, windows: windowsByDayId[row.id] ?? [] }
    }
  })
  return result
}

// Wipes and rewrites one profile's week — mirrors ManageRosterPage's own
// doPersist pattern (delete this scope's rows, then insert fresh ones)
// rather than trying to diff/upsert per day, since a day's mode can change
// entirely between saves. A day left at the plain default ('all_available'
// with no boundary/windows) is simply never written — "not filled in"
// really means "no row", not a row that happens to say available.
// `byDate` is the same shape loadWeekAvailability returns, but with each
// day's `dayRow` replaced by the in-progress edit shape
// `{ mode, boundaryTime, windows: [{start,end}] }` instead of a real row.
export async function saveWeekAvailability(profileId, weekStartStr, byDate) {
  const { data: existing } = await supabase
    .from('availability_days')
    .select('id')
    .eq('profile_id', profileId)
    .eq('week_start_date', weekStartStr)
  const existingIds = (existing ?? []).map((r) => r.id)
  if (existingIds.length) {
    const { error: delWinError } = await supabase.from('availability_windows').delete().in('availability_day_id', existingIds)
    if (delWinError) return { error: delWinError }
    const { error: delDayError } = await supabase.from('availability_days').delete().in('id', existingIds)
    if (delDayError) return { error: delDayError }
  }

  const toInsert = Object.entries(byDate)
    .filter(([, d]) => d.mode !== 'all_available')
    .map(([entryDate, d]) => ({
      profile_id: profileId,
      week_start_date: weekStartStr,
      entry_date: entryDate,
      mode: d.mode,
      boundary_time: d.mode === 'before' || d.mode === 'after' ? d.boundaryTime || null : null,
    }))
  if (!toInsert.length) return { error: null }

  const { data: inserted, error } = await supabase.from('availability_days').insert(toInsert).select()
  if (error) return { error }

  const windowRows = []
  inserted.forEach((row) => {
    if (row.mode !== 'custom') return
    ;(byDate[row.entry_date]?.windows ?? [])
      .filter((w) => w.start && w.end && w.end > w.start)
      .forEach((w) => windowRows.push({ availability_day_id: row.id, start_time: w.start, end_time: w.end }))
  })
  if (windowRows.length) {
    const { error: winError } = await supabase.from('availability_windows').insert(windowRows)
    if (winError) return { error: winError }
  }
  return { error: null }
}
