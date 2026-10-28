// Jeff, 2026-10-29: My Information uploads (TFN / Super / Consent files) and bank details are
// kept for 30 days only — daily cleanup jobs in migrations 0154 and 0155 do the deleting.
export const RETENTION_DAYS = 30

// "November 28" — the day the data is removed (saved/uploaded time + 30 days), in Brisbane time.
export function retainedUntil(savedAt) {
  const d = new Date(new Date(savedAt).getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-AU', { month: 'long', day: 'numeric', timeZone: 'Australia/Brisbane' })
    .format(d)
    .split(' ')
    .reverse()
    .join(' ')
}
