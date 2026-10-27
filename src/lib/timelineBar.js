// Shared time-axis + color helpers for a "spans a window, drawn as colored
// segments with hourly tick marks" timeline — RosterSettingsPage.jsx's
// Labour Allocation tab introduced this first (one horizontal bar per
// weekday, segments = staffing rules). StaffAvailabilityModal's "By Date"
// tab (2026-10-27, Jeff: "其操作方法跟labour allocation看時間色條的邏輯一
// 樣") reuses the exact same mechanics, keyed by staff member instead of by
// time-slot label — pulled out here so both stay identical rather than two
// copies that can quietly drift apart.

// "16:00:00" / "16:00" -> 960 (minutes since midnight). Blank/undefined
// falls back to midnight rather than throwing, since a store's hours can be
// unset.
export function timeToMinutes(raw) {
  const [h, m] = (raw || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function formatTime(raw) {
  const mins = timeToMinutes(raw)
  const h24 = Math.floor(mins / 60)
  const m = mins % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Same as formatTime, but the input is already minutes-since-midnight
// rather than a "HH:MM" string (availability.js's computeAvailableWindows
// shape).
export function formatMinutes(mins) {
  const h24 = Math.floor(mins / 60) % 24
  const m = mins % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Short axis-tick label, e.g. 630 -> "10:30am", 1080 -> "6pm".
export function formatTickLabel(mins) {
  const h24 = Math.floor(mins / 60) % 24
  const m = mins % 60
  const ampm = h24 >= 12 ? 'pm' : 'am'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

// Tick marks across [open, close] — always includes both ends, plus evenly
// spaced hour marks in between (coarser for a long window, finer for a
// short one) so the axis stays readable whether a store is open 4 hours or
// 20.
export function buildTicks(open, close) {
  const span = close - open
  const step = span > 12 * 60 ? 180 : span > 6 * 60 ? 120 : span > 2 * 60 ? 60 : 30
  const ticks = new Set([open, close])
  for (let t = Math.ceil(open / step) * step; t < close; t += step) ticks.add(t)
  return Array.from(ticks).sort((a, b) => a - b)
}

// Jeff, 2026-10-27: StaffAvailabilityModal's "By Date" tab asked for a tick
// every hour regardless of how wide the store's open/close window is
// ("時間也是每一小時一個刻度" — then, once seeing the adaptive 3-hour
// spacing buildTicks above gives a long window: "有辦法詳細一點嗎"). Always
// one tick per hour, plus the exact open/close ends if they fall off the
// hour — unlike buildTicks, which widens its step for a long window so
// RosterSettingsPage.jsx's shift-label timeline doesn't get crowded; that
// tradeoff isn't what was asked for here, so this is a separate function
// rather than a change to buildTicks itself.
export function buildHourlyTicks(open, close) {
  const ticks = new Set([open, close])
  for (let t = Math.ceil(open / 60) * 60; t < close; t += 60) ticks.add(t)
  return Array.from(ticks).sort((a, b) => a - b)
}

// One color per distinct key (a time-slot label, a person — whatever the
// caller is coloring by), so the same key reads the same color everywhere
// at a glance. Picked by hashing the text rather than by order of
// appearance, so a key's color stays the same across reloads regardless of
// what order rows come back in. Two DIFFERENT keys can still hash to the
// same color though — pickColor nudges one of them to the next palette
// color whenever that would land two different keys right next to each
// other, so touching segments never blend together.
export const BAR_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#0891b2', '#ca8a04', '#db2777']
export function colorForLabel(label) {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return BAR_COLORS[hash % BAR_COLORS.length]
}
export function pickColor(label, prevColor) {
  const base = colorForLabel(label)
  if (base !== prevColor) return base
  const idx = BAR_COLORS.indexOf(base)
  return BAR_COLORS[(idx + 1) % BAR_COLORS.length]
}
