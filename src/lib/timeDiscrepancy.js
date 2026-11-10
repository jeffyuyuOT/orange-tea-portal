import { addDays, format, parseISO } from 'date-fns'
import { supabase } from './supabaseClient'
import { pairEventsIntoSessions, dailyTotals, breakMinutesFromHalfHours } from './attendance'
import { brisbaneLocalToIso } from './brisbaneTime'

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
//
// Jeff, 2026-11-10 (Attendance Exceptions): `range` ({ from, to }, both 'yyyy-MM-dd') scans
// that span instead of the default last-DISCREPANCY_WINDOW_DAYS days, so the Attendance
// Exceptions view can look at any single week. Each returned day also carries what that view
// needs to show and to sync the roster: the roster entry's id/period, the day's clock sessions
// and the attendance-side break. Everything else about the check is unchanged.
export async function getStaffTimeDiscrepancies(storeId, profileIds, range = null) {
  if (!storeId || !profileIds?.length) return {}
  // Jeff, 2026-11-11: "為什麼admin Jeff chuang還在清單裡" — admin/developer accounts don't clock in
  // to be checked against a roster, so they are never flagged: not as a red dot, not in a
  // person's detail, not in Attendance Exceptions.
  const { data: roleRows } = await supabase.from('profiles').select('id, role').in('id', profileIds)
  const exempt = new Set((roleRows ?? []).filter((r) => r.role === 'admin' || r.role === 'developer').map((r) => r.id))
  if (exempt.size) profileIds = profileIds.filter((id) => !exempt.has(id))
  if (!profileIds.length) return {}

  const today = todayStr()
  const nowMinutes = nowMinutesOfDay()
  const fromDate = range?.from ?? format(addDays(new Date(), -(DISCREPANCY_WINDOW_DAYS - 1)), 'yyyy-MM-dd')
  const toDate = range?.to ?? today
  // Periods are weekly (Monday-start) — a period covering the window's start
  // date can begin up to 6 days before it.
  const periodsFrom = format(addDays(new Date(fromDate), -6), 'yyyy-MM-dd')
  const eventsUpperIso = range
    ? brisbaneLocalToIso(`${format(addDays(parseISO(toDate), 1), 'yyyy-MM-dd')}T23:59`)
    : '2100-01-01T00:00:00Z'

  const [{ data: periodRows }, { data: eventRows }, { data: changeRows }, { data: breakRows }, { data: hideRows }] = await Promise.all([
    supabase
      .from('roster_periods')
      .select('id')
      .eq('store_id', storeId)
      .eq('status', 'submitted')
      .gte('week_start_date', periodsFrom)
      .lte('week_start_date', toDate),
    supabase
      .from('attendance_events')
      .select('*')
      .eq('store_id', storeId)
      .in('profile_id', profileIds)
      // Jeff, 2026-10-22: "只抓到第二段的時間2:02-4:06pm那段" — Sophie's
      // 9:28am punch (Brisbane time) on the window's own oldest day got
      // silently dropped, leaving its clock-out orphaned and only the
      // later 2:02-4:06pm session counted. Root cause: this used to send
      // `${fromDate}T00:00:00` with no timezone offset — PostgREST reads a
      // bare timestamp like that as UTC, not Brisbane, so the cutoff landed
      // at Brisbane 10:00am on fromDate instead of Brisbane midnight. Any
      // punch before 10am on the oldest day of the 14-day window (occurred_at
      // is a real UTC instant, so Brisbane's early morning is still the
      // PREVIOUS UTC calendar day) fell just before that wrong cutoff and
      // was excluded from the query entirely — not merely misdated, actually
      // never fetched, which is why its matching clock-out above came back
      // with no clockIn to pair with (an orphan dailyTotals silently
      // ignores) instead of showing up as a second, too-short session.
      // brisbaneLocalToIso (used everywhere else this app turns a
      // Brisbane-wall-clock date/time into a timestamptz boundary) fixes
      // the same class of bug this file already explains for leave
      // requests — just missed here.
      .gte('occurred_at', brisbaneLocalToIso(`${fromDate}T00:00`))
      // Only a custom range needs an upper bound (a punch just after midnight at the end of
      // the last day still belongs to that day's shift); the default window runs to now.
      .lte('occurred_at', eventsUpperIso),
    supabase
      .from('roster_change_events')
      .select('profile_id, changed_at')
      .eq('store_id', storeId)
      .in('profile_id', profileIds)
      // Same fix, same reason — changed_at is a timestamptz too.
      .gte('changed_at', brisbaneLocalToIso(`${fromDate}T00:00`)),
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
      .lte('event_date', toDate),
    // Jeff, 2026-10-11: "每一筆的後面都新增Hide prompts，勾取的話此筆紀錄就
    // 不會造成小紅點提示" — a per-(profile, day) dismissal, global across
    // every viewer (see migration 0100's comment for why this is shaped
    // differently from time_discrepancy_views below, which is per-viewer).
    // A hidden day still comes back in `days` (so the checkbox can be shown
    // and unchecked again later) — it's just marked `hidden: true` so
    // callers can exclude it from the red-dot/unread computation.
    supabase
      .from('time_discrepancy_hides')
      .select('profile_id, work_date')
      .eq('store_id', storeId)
      .in('profile_id', profileIds)
      .gte('work_date', fromDate)
      .lte('work_date', toDate),
  ])

  const hiddenKeys = new Set((hideRows ?? []).map((h) => `${h.profile_id}|${h.work_date}`))

  const periodIds = (periodRows ?? []).map((p) => p.id)
  if (!periodIds.length) return {}

  const { data: entryRows } = await supabase
    .from('roster_entries')
    .select('id, roster_period_id, profile_id, work_date, start_time, end_time, break_half_hours')
    .in('roster_period_id', periodIds)
    .in('profile_id', profileIds)
    .gte('work_date', fromDate)
    .lte('work_date', toDate)

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
  const sessionsByProfile = new Map() // profileId -> paired sessions (for the Attendance Exceptions view)
  const openDatesByProfile = new Map() // profileId -> Set('yyyy-MM-dd')
  eventsByProfile.forEach((events, profileId) => {
    const sessions = pairEventsIntoSessions(events)
    sessionsByProfile.set(profileId, sessions)
    totalsByProfile.set(profileId, dailyTotals(sessions))
    const openDates = new Set(sessions.filter((s) => s.inProgress && s.date).map((s) => s.date))
    openDatesByProfile.set(profileId, openDates)
  })

  const breakMinutesByProfileDate = new Map() // `${profileId}|${date}` -> minutes to net out
  const breakHalfHoursByProfileDate = new Map() // same key -> the raw half-hour units logged
  ;(breakRows ?? []).forEach((b) => {
    breakHalfHoursByProfileDate.set(`${b.profile_id}|${b.event_date}`, b.break_half_hours)
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
      hidden: hiddenKeys.has(`${entry.profile_id}|${entry.work_date}`),
      // Jeff, 2026-11-10 (Attendance Exceptions): what the exceptions list shows and what
      // "Sync" writes back to — the roster row itself, plus the day's clock sessions
      // (ISO timestamps) and the break logged on the attendance side.
      entryId: entry.id,
      periodId: entry.roster_period_id,
      sessions: (sessionsByProfile.get(entry.profile_id) ?? [])
        .filter((sess) => sess.date === entry.work_date)
        .map((sess) => ({
          clockIn: sess.clockIn?.occurred_at ?? null,
          clockOut: sess.clockOut?.occurred_at ?? null,
          minutes: sess.minutes,
          inProgress: !!sess.inProgress,
        })),
      attendanceBreakHalfHours: breakHalfHoursByProfileDate.has(`${entry.profile_id}|${entry.work_date}`)
        ? breakHalfHoursByProfileDate.get(`${entry.profile_id}|${entry.work_date}`)
        : null,
    })
  }
  for (const profileId in result) {
    result[profileId].days.sort((a, b) => b.date.localeCompare(a.date))
  }
  return result
}

// Jeff, 2026-10-24: "staff time log點擊每一天的日期，上面會跳出小視窗顯示
// 那一天的班表時間跟休息次數" — the same "rostered shift" popup
// getStaffTimeDiscrepancies already feeds for a flagged day's "Rostered
// Xh Ym" link, but for ANY day shown in the full Attendance Logs table
// below (AttendanceLogTable.jsx), not just the last DISCREPANCY_WINDOW_DAYS
// days' mismatched ones.
//
// Jeff, 2026-10-24 (follow-up): "loading的時間比上面time discrepancy點擊彈
// 出的時間久，是正常嗎?" — it WAS, because this used to be a per-day lookup
// (two fresh queries run on every single click) while the discrepancy
// popup above just re-displays a day object already sitting in memory from
// one getStaffTimeDiscrepancies call made on page load. Reshaped into a
// bulk fetch instead — every published roster_entries row this profile's
// EVER had, in one go, keyed by `${work_date}|${store_id}` — so
// AttendanceLogTable.jsx can fetch it once in its own load() (same place it
// already fetches this profile's whole attendance_events history, no date
// limit either) and have every click be a plain in-memory lookup, just as
// instant as the one above. Same "only a PUBLISHED roster counts" rule as
// getStaffTimeDiscrepancies (status = 'submitted') — a draft shift was
// never a real commitment, so it's not "that day's roster time" yet.
export async function getRosteredShiftsForProfile(profileId) {
  if (!profileId) return {}
  const { data: entryRows } = await supabase
    .from('roster_entries')
    .select('roster_period_id, work_date, start_time, end_time, break_half_hours')
    .eq('profile_id', profileId)
  if (!entryRows?.length) return {}
  const periodIds = Array.from(new Set(entryRows.map((e) => e.roster_period_id)))
  const { data: periodRows } = await supabase.from('roster_periods').select('id, store_id, status').in('id', periodIds)
  const periodById = new Map((periodRows ?? []).map((p) => [p.id, p]))
  const result = {}
  for (const entry of entryRows) {
    const period = periodById.get(entry.roster_period_id)
    if (!period || period.status !== 'submitted') continue
    result[`${entry.work_date}|${period.store_id}`] = {
      start_time: entry.start_time,
      end_time: entry.end_time,
      break_half_hours: entry.break_half_hours,
    }
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

// Jeff, 2026-10-11: a subject should only get the red dot while it has at
// least one flagged day that hasn't been individually hidden ("Hide
// prompts") — a profile whose only discrepancies are all hidden is no
// different from one with none at all.
export function hasVisibleDiscrepancy(discrepancy) {
  return !!discrepancy?.days?.some((d) => !d.hidden)
}

// Toggles the global per-(profile, store, day) "Hide prompts" flag — see
// migration 0100. Existence of a row = hidden, so checking the box inserts
// one and unchecking it deletes it; unlike markTimeDiscrepancySeen below,
// this is NOT scoped to the caller — every manager/admin viewer sees the
// same hidden state for this day from now on.
export async function setTimeDiscrepancyHidden(profileId, storeId, workDate, hidden, hiddenBy) {
  if (!profileId || !storeId || !workDate) return
  if (hidden) {
    await supabase
      .from('time_discrepancy_hides')
      .upsert(
        { profile_id: profileId, store_id: storeId, work_date: workDate, hidden_by: hiddenBy ?? null, hidden_at: new Date().toISOString() },
        { onConflict: 'profile_id,store_id,work_date' }
      )
  } else {
    await supabase
      .from('time_discrepancy_hides')
      .delete()
      .eq('profile_id', profileId)
      .eq('store_id', storeId)
      .eq('work_date', workDate)
  }
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

// ---------------------------------------------------------------------------------------------
// Jeff, 2026-11-10 (Attendance Exceptions > Sync): "校正的依據一般是以15分鐘為一個單位，將15分鐘
// 除以2，如果打卡時間比較靠近哪裡就將班表校正到那個時間" — the roster's start/end are pulled to
// the nearest quarter-hour of the actual clock-in / clock-out (more than 7.5 minutes past a
// quarter-hour goes up to the next one, less goes back to it; exactly halfway goes up).
export const SYNC_ROUNDING_MINUTES = 15

function localMinutesOfDay(iso) {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

export function roundToQuarterHour(minutes) {
  return Math.round(minutes / SYNC_ROUNDING_MINUTES) * SYNC_ROUNDING_MINUTES
}

function minutesToHHMM(minutes) {
  const m = (((Math.round(minutes) % 1440) + 1440) % 1440)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Same wall-clock label Attendance Logs shows, but 24-hour so it lines up with roster times.
export function clockLabel(iso) {
  return iso ? format(new Date(iso), 'HH:mm') : null
}

// The day's first clock-in and last clock-out, as ISO strings (null when there is none).
export function dayClockSpan(day) {
  const ins = (day.sessions ?? []).map((s) => s.clockIn).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))
  const outs = (day.sessions ?? []).map((s) => s.clockOut).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))
  return { firstIn: ins[0] ?? null, lastOut: outs[outs.length - 1] ?? null }
}

// What "Sync" proposes for a flagged day: start/end rounded from the first clock-in / last
// clock-out (a side with no punch keeps the roster's own value), and the break logged on the
// attendance side when there is one (otherwise the roster's existing break). Everything is only
// a starting point — the Sync dialog lets the manager edit all three before applying.
export function proposeRosterSync(day) {
  const { firstIn, lastOut } = dayClockSpan(day)
  const startTime = firstIn ? minutesToHHMM(roundToQuarterHour(localMinutesOfDay(firstIn))) : (day.rosterStartTime ?? '').slice(0, 5)
  const endTime = lastOut ? minutesToHHMM(roundToQuarterHour(localMinutesOfDay(lastOut))) : (day.rosterEndTime ?? '').slice(0, 5)
  const attBreak = day.attendanceBreakHalfHours
  const breakHalfHours = attBreak != null && attBreak !== '' ? Number(attBreak) || 0 : Number(day.rosterBreakHalfHours) || 0
  return {
    startTime,
    endTime,
    breakHalfHours,
    startFromClock: firstIn ? clockLabel(firstIn) : null,
    endFromClock: lastOut ? clockLabel(lastOut) : null,
    breakFromAttendance: attBreak != null && attBreak !== '',
  }
}

// Writes the corrected shift onto the published roster row. `.select('id')` so a row the
// database silently refused to touch (RLS) comes back as an error instead of looking saved.
// Deliberately does not log a roster_change_events row: this fixes a past day to match what
// happened, it isn't a schedule change staff need an "Update" badge for.
export async function applyRosterSync({ entryId, startTime, endTime, breakHalfHours }) {
  if (!entryId) return { error: new Error('Missing roster entry') }
  const breakValue = breakHalfHours === '' || breakHalfHours == null ? null : Number(breakHalfHours)
  const { data, error } = await supabase
    .from('roster_entries')
    .update({ start_time: `${startTime}:00`, end_time: `${endTime}:00`, break_half_hours: breakValue })
    .eq('id', entryId)
    .select('id')
  if (error) return { error }
  if (!data?.length) return { error: new Error('Not allowed to change this roster row') }
  return { error: null }
}
