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

export function formatMinutes(minutes) {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
