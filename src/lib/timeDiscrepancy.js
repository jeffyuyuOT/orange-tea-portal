import { addDays, format } from 'date-fns'
import { supabase } from './supabaseClient'
import { pairEventsIntoSessions, dailyTotals, breakMinutesFromHalfHours } from './attendance'

// Jeff, 2026-09: "staff time logs如果有員工的time logs算出的時間跟班表上算
// 出來的時間的有出入15mins以上，該員名字會顯示提示" — decided via
// AskUserQuestion: compare each day's TOTAL worked minutes (from clock in/
// out) against that day's scheduled minutes net of break, not the raw
// clock-in/clock-out times against start_time/end_time individually.
export const DISCREPANCY_THRESHOLD_MINUTES = 15

// Also decided via AskUserQuestion: only scan the most recent 14 days
// (matches Attendance Logs' own default 7-day view being well inside it)
// rather than a whole staff member's history — cheap to query, and an old,
// already-irrelevant mismatch shouldn't keep flagging someone's name.
export const DISCREPANCY_WINDOW_DAYS = 14

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

function nowMinutesOfDay() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

// end_time - start_time, net of break_half_hours (1 unit = 30 min — same
// unit RosterEntryGrid/excelRoster.js already use), in minutes. Handles a
// shift that crosses midnight (end_time < start_time) by adding a day. null
// if either time is missing — nothing to compare that day.
export function scheduledNetMinutes(entry) {
  if (!entry?.start_time || !entry?.end_time) return null
  const [sh, sm] = entry.start_time.slice(0, 5).split(':').map(Number)
  const [eh, em] = entry.end_time.slice(0, 5).split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  const breakMins = (Number(entry.break_half_hours) || 0) * 30
  return Math.max(0, mins - breakMins)
}

// Minutes-since-midnight this shift is scheduled to END, for deciding
// whether "today" has reached it yet — separate from scheduledNetMinutes
// above, which returns a DURATION, not a clock time. Returns null for a
// shift that crosses midnight (end_time < start_time): by wall-clock, that
// shift can never "already be over" within the same calendar day, so today
// should keep being skipped for it same as before this fix.
function shiftEndMinutesOfDay(entry) {
  if (!entry?.start_time || !entry?.end_time) return null
  const [sh, sm] = entry.start_time.slice(0, 5).split(':').map(Number)
  const [eh, em] = entry.end_time.slice(0, 5).split(':').map(Number)
  const startMinutes = sh * 60 + sm
  const endMinutes = eh * 60 + em
  if (endMinutes < startMinutes) return null
  return endMinutes
}

// Returns { [profileId]: { days: [{ date, scheduledMinutes, actualMinutes, diffMinutes }], latestSignal } }
// — only for profiles that actually have at least one flagged day in the
// window. `latestSignal` is an ISO timestamp (or null) — the most recent of
// that profile's own attendance_events.created_at / roster_change_events
// changed_at within the window, used by callers to decide whether a
// previously-cleared alert (time_discrepancy_views) should re-appear.
//
// Only ever compares against a PUBLISHED roster (roster_periods.status =
// 'submitted') — a draft shift isn't a real commitment staff were told to
// work, so it's not a fair thing to flag someone's punches against.
//
// Today's own shifts are only skipped while they're still SCHEDULED to be
// in progress (current wall-clock time hasn't reached that shift's own
// end_time yet) — once a shift should already be over, a no-show or an
// early clock-out today is just as real a discrepancy as any past day's
// (Jeff, 2026-09-29: "brookside的gretl為什麼今天沒有clock in/out但沒有提示
// 跟班表不一樣" / "ava也是一樣" — both had already-finished shifts today
// with zero punches and neither was flagged, because this used to skip
// TODAY wholesale regardless of whether the shift had actually ended).
// Any day where this profile still has an open (no clock-out yet) session
// is still always skipped — that's someone still genuinely on shift right
// now, not a discrepancy.
export async function getStaffTimeDiscrepancies(storeId, profileIds) {
  if (!storeId || !profileIds?.length) return {}

  const today = todayStr()
  const nowMinutes = nowMinutesOfDay()
  const fromDate = format(addDays(new Date(), -(DISCREPANCY_WINDOW_DAYS - 1)), 'yyyy-MM-dd')
  // Periods are weekly (Monday-start) — a period covering the window's start
  // date can begin up to 6 days before it.
  const periodsFrom = format(addDays(new Date(fromDate), -6), 'yyyy-MM-dd')

  const [{ data: periodRows }, { data: eventRows }, { data: changeRows }, { data: breakRows }] = await Promise.all([
    supabase
      .from('roster_periods')
      .select('id')
      .eq('store_id', storeId)
      .eq('status', 'submitted')
      .gte('week_start_date', periodsFrom)
      .lte('week_start_date', today),
    supabase
      .from('attendance_events')
      .select('*')
      .eq('store_id', storeId)
      .in('profile_id', profileIds)
      .gte('occurred_at', `${fromDate}T00:00:00`),
    supabase
      .from('roster_change_events')
      .select('profile_id, changed_at')
      .eq('store_id', storeId)
      .in('profile_id', profileIds)
      .gte('changed_at', `${fromDate}T00:00:00`),
    // Jeff, 2026-10-03: "編輯attendance logs時如果有加入break...但在跟班表
    // 檢查出入時並沒有把休息時間扣掉" — Attendance Logs' own "Total" already
    // nets a day's logged break out of the raw clocked duration (see
    // attendance_day_breaks / breakMinutesFromHalfHours), but this check was
    // still comparing the RAW clocked total (totalsByProfile below, built
    // straight off attendance_events with no knowledge of breaks at all)
    // against the roster's own break-netted scheduledNetMinutes — so a
    // perfectly matching day with a logged break always looked "behind" by
    // exactly the break's length. Fetched here the same way Attendance Logs
    // itself reads it, so this check and that screen can never disagree on
    // what a day's actual worked time nets out to.
    supabase
      .from('attendance_day_breaks')
      .select('profile_id, event_date, break_half_hours')
      .eq('store_id', storeId)
      .in('profile_id', profileIds)
      .gte('event_date', fromDate)
      .lte('event_date', today),
  ])

  const periodIds = (periodRows ?? []).map((p) => p.id)
  if (!periodIds.length) return {}

  const { data: entryRows } = await supabase
    .from('roster_entries')
    .select('profile_id, work_date, start_time, end_time, break_half_hours')
    .in('roster_period_id', periodIds)
    .in('profile_id', profileIds)
    .gte('work_date', fromDate)
    .lte('work_date', today)

  // Per-profile daily worked totals, and which (profile, date) pairs still
  // have an open session — both from the same paired-sessions logic
  // Attendance Logs itself uses, just grouped by profile first since that
  // helper works on one person's events at a time.
  const eventsByProfile = new Map()
  ;(eventRows ?? []).forEach((e) => {
    if (!eventsByProfile.has(e.profile_id)) eventsByProfile.set(e.profile_id, [])
    eventsByProfile.get(e.profile_id).push(e)
  })
  const totalsByProfile = new Map() // profileId -> { 'yyyy-MM-dd': minutes }
  const openDatesByProfile = new Map() // profileId -> Set('yyyy-MM-dd')
  eventsByProfile.forEach((events, profileId) => {
    const sessions = pairEventsIntoSessions(events)
    totalsByProfile.set(profileId, dailyTotals(sessions))
    const openDates = new Set(sessions.filter((s) => s.inProgress && s.date).map((s) => s.date))
    openDatesByProfile.set(profileId, openDates)
  })

  const breakMinutesByProfileDate = new Map() // `${profileId}|${date}` -> minutes to net out
  ;(breakRows ?? []).forEach((b) => {
    breakMinutesByProfileDate.set(`${b.profile_id}|${b.event_date}`, breakMinutesFromHalfHours(b.break_half_hours))
  })

  const latestAttendanceByProfile = new Map()
  ;(eventRows ?? []).forEach((e) => {
    const cur = latestAttendanceByProfile.get(e.profile_id) ?? ''
    if (e.created_at > cur) latestAttendanceByProfile.set(e.profile_id, e.created_at)
  })
  const latestChangeByProfile = new Map()
  ;(changeRows ?? []).forEach((r) => {
    const cur = latestChangeByProfile.get(r.profile_id) ?? ''
    if (r.changed_at > cur) latestChangeByProfile.set(r.profile_id, r.changed_at)
  })

  const result = {}
  for (const entry of entryRows ?? []) {
    if (!entry.profile_id || entry.work_date > today) continue // future shift — nothing to compare yet
    if (entry.work_date === today) {
      const endMinutes = shiftEndMinutesOfDay(entry)
      if (endMinutes == null || nowMinutes < endMinutes) continue // shift hasn't finished yet (or crosses midnight)
    }
    if (openDatesByProfile.get(entry.profile_id)?.has(entry.work_date)) continue // still clocked in that day

    const scheduledMinutes = scheduledNetMinutes(entry)
    if (scheduledMinutes == null) continue

    const rawActualMinutes = totalsByProfile.get(entry.profile_id)?.[entry.work_date] ?? 0
    const breakMinutes = breakMinutesByProfileDate.get(`${entry.profile_id}|${entry.work_date}`) ?? 0
    const actualMinutes = Math.max(0, rawActualMinutes - breakMinutes)
    const diffMinutes = actualMinutes - scheduledMinutes
    if (Math.abs(diffMinutes) < DISCREPANCY_THRESHOLD_MINUTES) continue

    if (!result[entry.profile_id]) {
      const latest = [latestAttendanceByProfile.get(entry.profile_id), latestChangeByProfile.get(entry.profile_id)]
        .filter(Boolean)
        .sort()
        .pop()
      result[entry.profile_id] = { days: [], latestSignal: latest ?? null }
    }
    result[entry.profile_id].days.push({
      date: entry.work_date,
      scheduledMinutes,
      actualMinutes,
      diffMinutes,
      // Jeff, 2026-10-07: "在staff time logs裡顯示...Rostered time的地方點擊
      // 跳出視窗顯示roster上的時間跟break次數" — scheduledMinutes above is
      // already a netted DURATION, not a clock time, so the raw roster
      // fields are carried through too for that popup to actually show a
      // start/end time and a break count.
      rosterStartTime: entry.start_time,
      rosterEndTime: entry.end_time,
      rosterBreakHalfHours: entry.break_half_hours,
    })
  }
  for (const profileId in result) {
    result[profileId].days.sort((a, b) => b.date.localeCompare(a.date))
  }
  return result
}

// A subject counts as "unread" for this viewer when there's no
// time_discrepancy_views row at all, or it's older than the discrepancy's
// own latestSignal (a punch correction or a re-published roster since the
// last time this viewer cleared it re-flags it).
export function isUnreadDiscrepancy(discrepancy, viewedAt) {
  if (!discrepancy) return false
  if (!viewedAt) return true
  if (!discrepancy.latestSignal) return false // nothing timestamped to compare — treat a prior read as still covering it
  return discrepancy.latestSignal > viewedAt
}

// Called when a manager/admin opens a staff member's Staff Time Logs detail
// — clears the alert for THIS viewer only (Jeff: "跟隨user, userA看過後並
// 不會影響user B的提示").
export async function markTimeDiscrepancySeen(viewerId, subjectProfileId) {
  if (!viewerId || !subjectProfileId) return
  await supabase
    .from('time_discrepancy_views')
    .upsert({ viewer_id: viewerId, subject_profile_id: subjectProfileId, viewed_at: new Date().toISOString() }, { onConflict: 'viewer_id,subject_profile_id' })
}
