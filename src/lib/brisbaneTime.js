// Jeff, 2026-10-02: root cause behind leave requests showing wrong times
// like "10:00 AM – (next day) 9:59 AM" for what was meant to be a single
// whole day. A `datetime-local` input's value ("YYYY-MM-DDTHH:MM") carries
// no timezone of its own. ApplyLeaveTab/EditLeaveTab used to send that bare
// string straight to Supabase; with no offset attached, Postgres stores it
// against the database's own timezone (UTC on this project), not Brisbane
// wall-clock time — silently shifting every leave by Brisbane's UTC offset
// (the default 00:00/23:59 whole-day bounds become 10:00/09:59-next-day
// once read back and converted to the browser's local time for display).
//
// Queensland has no daylight saving, so Brisbane is a fixed UTC+10 all
// year round — no timezone library or DST table needed, just this one
// constant and a bit of arithmetic.
export const BRISBANE_UTC_OFFSET_HOURS = 10

// `datetime-local` value ("YYYY-MM-DDTHH:MM", Brisbane wall-clock time, as
// typed) -> a proper ISO timestamp with the Brisbane offset attached, safe
// to send to a `timestamptz` column.
export function brisbaneLocalToIso(datetimeLocalValue) {
  if (!datetimeLocalValue) return null
  return `${datetimeLocalValue}:00+${String(BRISBANE_UTC_OFFSET_HOURS).padStart(2, '0')}:00`
}

// Reverse direction — a timestamptz value read back from Supabase (real
// UTC) -> the Brisbane wall-clock `datetime-local` string that produced it,
// so re-opening a leave for editing shows exactly what was originally
// typed instead of a raw, wrong-timezone string.
export function isoToBrisbaneLocal(isoValue) {
  if (!isoValue) return ''
  const utc = new Date(isoValue)
  const brisbane = new Date(utc.getTime() + BRISBANE_UTC_OFFSET_HOURS * 60 * 60 * 1000)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${brisbane.getUTCFullYear()}-${pad2(brisbane.getUTCMonth() + 1)}-${pad2(brisbane.getUTCDate())}T${pad2(brisbane.getUTCHours())}:${pad2(brisbane.getUTCMinutes())}`
}
