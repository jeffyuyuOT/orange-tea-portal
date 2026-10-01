import { format } from 'date-fns'
import { supabase } from './supabaseClient'

// How often the store's QR code display (QrCodeDisplayPage.jsx) rolls over
// to a fresh code. 15s (rather than every 1s, which was the first cut of
// this) gives staff enough time to actually get the camera up and scan
// before the code they're looking at changes underneath them.
export const QR_REFRESH_MS = 15000

// How old a scanned QR's timestamp is allowed to be before it's rejected as
// stale — rules out someone clocking in off a screenshot of an old code
// rather than the code actually on screen right now. Set a bit above
// QR_REFRESH_MS: someone scanning right before a code rolls over can end up
// submitting a punch whose code is nearly a full refresh interval old, plus
// a few seconds of camera-decode/network time on top of that. This is a
// soft, client-side check, not a cryptographic guarantee; good enough for
// "were you actually standing in front of the phone" at the scale of one
// small business.
export const QR_FRESHNESS_MS = QR_REFRESH_MS + 5000

// `type` tags which of the two kinds of rotating QR this is (see
// buildStaffIdPayload below for the other one) — without it, a Staff ID
// code and a store code both happen to be small JSON objects with a `ts`,
// and a Staff ID payload also carries an (optional) `storeId`, so a scanner
// that only checked "does it have a storeId and a ts" could be fooled into
// accepting someone's personal Staff ID badge as if it were the store's own
// clock-in code. The two parse functions below each check `type` first and
// reject anything else outright, so a code can only ever be validated by
// the scanner it was actually meant for.
export function buildQrPayload(store) {
  return JSON.stringify({ type: 'store_clock', storeId: store.id, storeName: store.name, ts: new Date().toISOString() })
}

// Returns the parsed { storeId, storeName, ts } or null if the scanned code
// isn't one of ours (wrong shape/type) or is too old.
export function parseAndValidateQrPayload(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed?.type !== 'store_clock' || !parsed?.storeId || !parsed?.ts) return null
  const age = Date.now() - new Date(parsed.ts).getTime()
  if (!Number.isFinite(age) || age < -5000 || age > QR_FRESHNESS_MS) return null
  return parsed
}

// A person's own rotating "Staff ID" badge (My Information > My Staff ID) —
// the reverse direction of the store's code above: here a PERSON is proving
// who they are and which store they're currently at, and the store's 2D
// Code Maker phone scans THEM (its own "Scan Staff ID" button on
// QrCodeDisplayPage.jsx). Same QR_REFRESH_MS/QR_FRESHNESS_MS cadence as the
// store code, for the same reason (a screenshotted badge stops working
// after one refresh cycle). `store` is whichever store this person
// currently has selected — for someone who works at more than one, that's
// on them to have switched to the right one before showing this.
export function buildStaffIdPayload(profile, store) {
  return JSON.stringify({
    type: 'staff_id',
    profileId: profile.id,
    name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim(),
    storeId: store?.id ?? null,
    storeName: store?.name ?? null,
    ts: new Date().toISOString(),
  })
}

// Returns the parsed { profileId, name, storeId, storeName, ts } or null if
// the scanned code isn't a Staff ID code (wrong shape/type — e.g. someone
// pointed the scanner at the store's own clock-in code instead) or is too
// old.
export function parseAndValidateStaffIdPayload(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed?.type !== 'staff_id' || !parsed?.profileId || !parsed?.name || !parsed?.ts) return null
  const age = Date.now() - new Date(parsed.ts).getTime()
  if (!Number.isFinite(age) || age < -5000 || age > QR_FRESHNESS_MS) return null
  return parsed
}

// The person's single most recent punch (across all time, not just today —
// an overnight shift clocking out after midnight still belongs to the same
// "currently clocked in" state), or null if they've never punched at all.
// Exported so the Clock In/Out tab can show "Currently clocked in since…"
// without duplicating this query.
export async function getLastEvent(profileId) {
  const { data } = await supabase
    .from('attendance_events')
    .select('*')
    .eq('profile_id', profileId)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// A punch always alternates with the person's own last punch, so there's
// nothing to configure: clock in if they're not currently clocked in
// anywhere, clock out if they are.
async function getNextEventType(profileId) {
  const last = await getLastEvent(profileId)
  return last?.event_type === 'clock_in' ? 'clock_out' : 'clock_in'
}

// Records a punch at the store the scanned QR named. `occurred_at` is left
// to the database's own now() default rather than trusting the QR's ts or
// the phone's clock for the record itself — the QR's ts is only ever used
// for the freshness check above.
export async function submitClockEvent(profileId, storeId) {
  const eventType = await getNextEventType(profileId)
  const { data, error } = await supabase
    .from('attendance_events')
    .insert({ profile_id: profileId, store_id: storeId, event_type: eventType })
    .select()
    .single()
  return { data, error, eventType }
}

// Pairs a chronological list of a person's clock_in/clock_out rows into
// shifts, tolerating the odd out-of-order anomaly (two clock_ins in a row,
// or a clock_out with nothing open) rather than throwing — those show up
// as a session with no end (still "in progress") or a zero-length one
// rather than crashing the page.
export function pairEventsIntoSessions(events) {
  const sorted = [...events].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
  const sessions = []
  let openIn = null
  for (const ev of sorted) {
    if (ev.event_type === 'clock_in') {
      if (openIn) sessions.push({ clockIn: openIn, clockOut: null, inProgress: true })
      openIn = ev
    } else {
      sessions.push({ clockIn: openIn, clockOut: ev, inProgress: false })
      openIn = null
    }
  }
  if (openIn) sessions.push({ clockIn: openIn, clockOut: null, inProgress: true })
  return sessions.map((s) => ({
    ...s,
    // A session is filed under the date it STARTED, even if it runs past
    // midnight — an overnight shift is one shift, not split across two days.
    date: s.clockIn ? format(new Date(s.clockIn.occurred_at), 'yyyy-MM-dd') : null,
    minutes:
      s.clockIn && s.clockOut
        ? Math.max(0, Math.round((new Date(s.clockOut.occurred_at) - new Date(s.clockIn.occurred_at)) / 60000))
        : null,
  }))
}

// { 'yyyy-MM-dd': totalMinutes } — sessions with no clock-out yet (still in
// progress) don't count toward a total until they're closed out.
export function dailyTotals(sessions) {
  const totals = {}
  for (const s of sessions) {
    if (s.date == null || s.minutes == null) continue
    totals[s.date] = (totals[s.date] ?? 0) + s.minutes
  }
  return totals
}

// Plain sum of every completed session's minutes — a still-open session (no
// clock-out yet) doesn't count, same as dailyTotals above. This is the
// "hours worked" figure Jeff's Learning Tracker/Bulletin/Progress Chart
// features (2026-09) are all built on: how long someone's actually been on
// shift since hire, as a fairer yardstick than calendar days for judging
// training pace (a 2-day-a-week part-timer and a full-timer shouldn't be
// held to the same calendar clock).
export function totalWorkedMinutes(sessions) {
  return sessions.reduce((sum, s) => sum + (s.minutes ?? 0), 0)
}

// Batch version of "how many minutes has each of these people worked,
// ever" — one query for the whole list instead of one per profile, for
// Learning Tracker's staff list and Bulletin's training-hours reminders,
// both of which need this for every unqualified staff member at a store at
// once. Returns a plain { profileId: minutes } map; a profile with no
// attendance_events rows at all (never clocked in, or hired before
// migration 0054 introduced this table) simply doesn't appear in the map —
// callers should treat a missing key as 0, not as an error.
export async function getWorkedMinutesByProfile(profileIds) {
  if (!profileIds?.length) return {}
  const { data } = await supabase.from('attendance_events').select('*').in('profile_id', profileIds)
  const byProfile = {}
  ;(data ?? []).forEach((ev) => {
    ;(byProfile[ev.profile_id] ??= []).push(ev)
  })
  const result = {}
  Object.entries(byProfile).forEach(([profileId, events]) => {
    result[profileId] = totalWorkedMinutes(pairEventsIntoSessions(events))
  })
  return result
}

export function formatMinutes(minutes) {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// Groups paired sessions into one "cell" per (date, store) — Jeff, 2026-09:
// someone who works at more than one store should see every store's
// punches, but grouped so a day's break-separated in/out pairs at the SAME
// store sit together, while the same day at a DIFFERENT store gets its own
// box. A session's store is whichever side of the pair actually has one
// (normally both clockIn and clockOut agree — they're only ever recorded
// at the store the scanned QR belonged to, see submitClockEvent above — so
// this is just which side to trust if one end is missing, e.g. still
// clocked in).
export function groupSessionsIntoCells(sessions) {
  const cells = new Map() // `${date}|${storeId}` -> { date, storeId, sessions: [] }
  for (const s of sessions) {
    const storeId = s.clockIn?.store_id ?? s.clockOut?.store_id ?? null
    if (!s.date || !storeId) continue
    const key = `${s.date}|${storeId}`
    if (!cells.has(key)) cells.set(key, { date: s.date, storeId, sessions: [] })
    cells.get(key).sessions.push(s)
  }
  return Array.from(cells.values())
}

// Combines a plain 'yyyy-MM-dd' date with a "HH:mm" time-of-day into an ISO
// timestamp, in the browser's own local time zone — same as how every
// existing occurred_at gets displayed elsewhere in this feature
// (`new Date(occurred_at).toLocaleString()` etc.), so a manager typing
// "9:00 AM" here lines up with what that already shows.
export function combineDateAndTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString()
}

// The three functions below are the manager/admin correction path (Jeff,
// 2026-09: "以防有員工忘記log in and out回報需要更改或新增log in and out時
// 間") — each one writes the punch itself (attendance_events) AND a
// matching row in attendance_event_edits (migration 0062) so every
// correction has a visible "who / when / why" audit trail. RLS on both
// tables independently enforces who's actually allowed to call these
// (can_edit_attendance_logs_check(), scoped to the editor's own stores) —
// these helpers don't re-check that client-side, they just shape the two
// writes consistently so the three call sites (add/edit/delete a punch)
// can't drift on what a history row looks like.

export async function addAttendanceEvent({ profileId, storeId, eventType, occurredAt, note, editor }) {
  const { data: event, error } = await supabase
    .from('attendance_events')
    .insert({ profile_id: profileId, store_id: storeId, event_type: eventType, occurred_at: occurredAt })
    .select()
    .single()
  if (error) return { error }
  const { error: editError } = await supabase.from('attendance_event_edits').insert({
    profile_id: profileId,
    store_id: storeId,
    event_date: format(new Date(occurredAt), 'yyyy-MM-dd'),
    action: 'add',
    event_id: event.id,
    after_event_type: eventType,
    after_occurred_at: occurredAt,
    note,
    edited_by: editor.id,
    edited_by_name: editor.name,
  })
  return { error: editError }
}

export async function updateAttendanceEvent({ event, eventType, occurredAt, note, editor }) {
  const { error } = await supabase
    .from('attendance_events')
    .update({ event_type: eventType, occurred_at: occurredAt })
    .eq('id', event.id)
  if (error) return { error }
  const { error: editError } = await supabase.from('attendance_event_edits').insert({
    profile_id: event.profile_id,
    store_id: event.store_id,
    // Filed under the punch's ORIGINAL date — the cell someone reviewing
    // history would have been looking at when they made this change —
    // even if the edit itself moved the punch to a different day.
    event_date: format(new Date(event.occurred_at), 'yyyy-MM-dd'),
    action: 'edit',
    event_id: event.id,
    before_event_type: event.event_type,
    before_occurred_at: event.occurred_at,
    after_event_type: eventType,
    after_occurred_at: occurredAt,
    note,
    edited_by: editor.id,
    edited_by_name: editor.name,
  })
  return { error: editError }
}

export async function deleteAttendanceEvent({ event, note, editor }) {
  // Logged BEFORE the delete — attendance_event_edits.event_id is ON
  // DELETE SET NULL (not cascade) specifically so this history row
  // survives with its own before_* snapshot once the punch itself is gone.
  const { error: editError } = await supabase.from('attendance_event_edits').insert({
    profile_id: event.profile_id,
    store_id: event.store_id,
    event_date: format(new Date(event.occurred_at), 'yyyy-MM-dd'),
    action: 'delete',
    event_id: event.id,
    before_event_type: event.event_type,
    before_occurred_at: event.occurred_at,
    note,
    edited_by: editor.id,
    edited_by_name: editor.name,
  })
  if (editError) return { error: editError }
  const { error } = await supabase.from('attendance_events').delete().eq('id', event.id)
  return { error }
}

// Jeff, 2026-10-02 ("add attendance record" redesign): a per-(profile,
// store, day) break value, in the SAME half-hour units as the roster's own
// roster_entries.break_half_hours (migration 0008 — "e.g. 1 = 30 min, 2 = 1
// hr"), stored in the new attendance_day_breaks table (migration 0089).
// One current-value row per cell (upserted), not an event log — see that
// migration's comment for why.
export function breakMinutesFromHalfHours(breakHalfHours) {
  const n = Number(breakHalfHours)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 30) : 0
}

// "break x2" / "break x1.5" — Jeff's own label shape from his spec example
// ("下面break x2"). null (not "x0") when there's nothing to show, so callers
// can skip rendering the badge entirely for a day with no break logged.
export function formatBreakUnits(breakHalfHours) {
  const n = Number(breakHalfHours)
  if (!Number.isFinite(n) || n <= 0) return null
  return `×${n % 1 === 0 ? n : n.toFixed(1)}`
}

// profileId -> keyed by cellKey(date, storeId) in the caller (same grouping
// AttendanceLogTable already uses for punches/edits) — returns the raw rows
// so the caller decides how to key them, same shape as the events/edits
// queries it already runs alongside this one.
export async function getAttendanceDayBreaks(profileId) {
  const { data } = await supabase.from('attendance_day_breaks').select('*').eq('profile_id', profileId)
  return data ?? []
}

// Upsert (one row per profile/store/day) — same "write the value, plus who/
// when/why" shape as the punch-correction functions above, but a single
// current-value row rather than an audit-trail insert, since that's all
// Jeff asked this feature to carry (migration 0089's comment). `note` is
// the same required reason the modal already collects for punch edits
// (migration 0090 added the column after this was first missed).
export async function upsertAttendanceDayBreak({ profileId, storeId, eventDate, breakHalfHours, note, editor }) {
  const { error } = await supabase.from('attendance_day_breaks').upsert(
    {
      profile_id: profileId,
      store_id: storeId,
      event_date: eventDate,
      break_half_hours: breakHalfHours,
      note,
      edited_by: editor.id,
      edited_by_name: editor.name,
      edited_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id,store_id,event_date' }
  )
  return { error }
}

// Jeff, 2026-10-02: "Copy roster...則會直接將clock in/out的時間照班表帶入，
// 並有幾次休息" — pulls ONE day's published ('submitted', migration 0048)
// roster shift for this person at this store, the same source
// src/lib/timeDiscrepancy.js already reads scheduled times from. A roster
// period can be re-saved (migration 0048's own "allows re-saving
// iterations" comment), so this takes the latest submitted period whose
// week actually covers the date, same as timeDiscrepancy's own "latest
// submitted wins" handling. Returns null when there's no published shift
// for that day — nothing to copy — rather than throwing, so the caller can
// just show "no roster shift found" instead of a crash.
export async function getRosterShiftForDay(profileId, storeId, dateStr) {
  const { data: period } = await supabase
    .from('roster_periods')
    .select('id')
    .eq('store_id', storeId)
    .eq('status', 'submitted')
    .lte('week_start_date', dateStr)
    .gte('week_end_date', dateStr)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!period) return null

  const { data: entry } = await supabase
    .from('roster_entries')
    .select('start_time, end_time, break_half_hours')
    .eq('roster_period_id', period.id)
    .eq('profile_id', profileId)
    .eq('work_date', dateStr)
    .maybeSingle()
  if (!entry?.start_time || !entry?.end_time) return null

  return {
    startTime: entry.start_time.slice(0, 5),
    endTime: entry.end_time.slice(0, 5),
    breakHalfHours: Number(entry.break_half_hours) || 0,
  }
}
