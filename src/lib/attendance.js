import { format } from 'date-fns'
import { supabase } from './supabaseClient'

// How old a scanned QR's timestamp is allowed to be before it's rejected as
// stale — rules out someone clocking in off a screenshot of an old code
// (the code on the display device changes every second — see
// QrCodeDisplayPage.jsx) rather than the code actually on screen right now.
// This is a soft, client-side check, not a cryptographic guarantee; good
// enough for "were you actually standing in front of the phone" at the
// scale of one small business.
export const QR_FRESHNESS_MS = 15000

export function buildQrPayload(store) {
  return JSON.stringify({ storeId: store.id, storeName: store.name, ts: new Date().toISOString() })
}

// Returns the parsed { storeId, storeName, ts } or null if the scanned code
// isn't one of ours (wrong shape) or is too old.
export function parseAndValidateQrPayload(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed?.storeId || !parsed?.ts) return null
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

export function formatMinutes(minutes) {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
