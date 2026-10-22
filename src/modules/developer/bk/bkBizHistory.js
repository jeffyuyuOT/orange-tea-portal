// Pure maths for 歷史紀錄 › 營業: only 總營業額 and 總杯數, per day, rolled up into
// quarters / months / days / events / weekdays. No Supabase here so it can be
// tested on its own.
import { round2, sumOrNull } from './bkUtils'
import { bizDayRow, bizDaysFromRows, postMapFromRows } from './bkSalesUtils'

export const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']
export const QUARTER_MONTHS = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] }

export const yearOf = (date) => Number(date.slice(0, 4))
export const monthOf = (date) => Number(date.slice(5, 7))
export const quarterOf = (month) => Math.ceil(month / 3)
// Monday = 0 … Sunday = 6
export function weekdayIndex(date) {
  const [y, m, d] = date.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

// { [storeId]: { [date]: { total, cups } } } — each store's own 總營業額 / 總杯數
// (POS + Self O + CV×4, P杯數 + SO杯數; a linked store's POS is SF's O.POST).
// Only days that actually have a figure are kept.
export function buildStoreDays(stores, salesRows, postRows) {
  const out = {}
  for (const s of stores) {
    const days = bizDaysFromRows(salesRows.filter((r) => r.store_id === s.id))
    const postMap = s.sf_store_id ? postMapFromRows(postRows.filter((r) => r.sf_store_id === s.sf_store_id)) : null
    const dates = new Set(Object.keys(days))
    if (postMap) for (const d of Object.keys(postMap)) dates.add(d)
    const map = {}
    for (const d of dates) {
      const r = bizDayRow(days[d], postMap ? (postMap[d] ?? null) : undefined)
      if (r.total !== null || r.cups !== null) map[d] = { total: r.total, cups: r.cups }
    }
    out[s.id] = map
  }
  return out
}

// Sum the chosen stores per date → [{ date, total, cups }] sorted by date.
export function aggregateDays(storeDays, storeIds) {
  const byDate = {}
  for (const id of storeIds) {
    for (const [date, v] of Object.entries(storeDays[id] ?? {})) {
      const cur = (byDate[date] ??= { totals: [], cups: [] })
      cur.totals.push(v.total)
      cur.cups.push(v.cups)
    }
  }
  return Object.keys(byDate)
    .sort()
    .map((date) => ({ date, total: sumOrNull(byDate[date].totals), cups: sumOrNull(byDate[date].cups) }))
}

// Sum of the records matching `pred`; null when nothing matches.
export function sumRecords(records, pred = () => true) {
  const hit = records.filter((r) => pred(r.date))
  if (hit.length === 0) return { total: null, cups: null, days: 0, avgCups: null }
  const cups = sumOrNull(hit.map((r) => r.cups))
  // 日均杯數 = 總杯數 ÷ the days that actually have a cup figure.
  const cupDays = hit.filter((r) => r.cups !== null && r.cups !== undefined).length
  return {
    total: sumOrNull(hit.map((r) => r.total)),
    cups,
    days: hit.length,
    avgCups: cups !== null && cupDays > 0 ? round2(cups / cupDays) : null,
  }
}

// Years that have any record, newest first.
export function recordYears(records) {
  return [...new Set(records.map((r) => yearOf(r.date)))].sort((a, b) => b - a)
}

// 季紀錄: the 4 quarters of one year.
export function quartersOfYear(records, year) {
  return [1, 2, 3, 4].map((q) => ({ key: q, label: `Q${q}`, ...sumRecords(records, (d) => yearOf(d) === year && quarterOf(monthOf(d)) === q) }))
}
// Same quarter in every year (newest first).
export function quarterAcrossYears(records, q) {
  return recordYears(records).map((y) => ({ year: y, ...sumRecords(records, (d) => yearOf(d) === y && quarterOf(monthOf(d)) === q) }))
}

// 月紀錄: the 12 months of one year.
export function monthsOfYear(records, year) {
  return Array.from({ length: 12 }, (_, i) => ({
    key: i + 1,
    label: `${i + 1} 月`,
    ...sumRecords(records, (d) => yearOf(d) === year && monthOf(d) === i + 1),
  }))
}
export function monthAcrossYears(records, m) {
  return recordYears(records).map((y) => ({ year: y, ...sumRecords(records, (d) => yearOf(d) === y && monthOf(d) === m) }))
}

// 日記錄: every record of one month.
export function daysOfMonth(records, year, month) {
  return records.filter((r) => yearOf(r.date) === year && monthOf(r.date) === month)
}
// Same calendar day (MM-DD) in every year.
export function dayAcrossYears(records, mmdd) {
  return records.filter((r) => r.date.slice(5) === mmdd).sort((a, b) => (a.date < b.date ? 1 : -1))
}

// Events = notes + public holidays. `notes` = [{ store_id, day, note }],
// `holidays` = { [date]: name }. Only the stores in `storeIds` contribute notes.
// → [{ date, label, kind: 'note'|'holiday' }] sorted by date.
// "Queen's Birthday" (until 2022) and "King's Birthday" are the same holiday, so they share a key.
// The year in a note ("2025周年慶") is not part of the event, and every note that mentions
// 周年慶 / 週年慶 / anniversary is the same event, so 歷年 shows them all together.
const SAME_EVENT_WORDS = [[/周年慶|週年慶|anniversary/, '周年慶']]
export const eventKey = (label) => {
  const k = label
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/queen'?s birthday/g, "king's birthday")
    .replace(/(?<!\d)(19|20)\d{2}(?!\d)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [re, key] of SAME_EVENT_WORDS) if (re.test(k)) return key
  return k
}
export function buildEvents(notes, holidays, storeIds) {
  const ids = new Set(storeIds)
  const seen = new Set()
  const out = []
  for (const n of notes) {
    if (!ids.has(n.store_id)) continue
    const label = n.note.trim()
    const k = `${n.day}|n|${eventKey(label)}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ date: n.day, label, kind: 'note' })
  }
  for (const [date, name] of Object.entries(holidays)) out.push({ date, label: name, kind: 'holiday' })
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.label < b.label ? -1 : 1))
}
// Attach the day's 總營業額 / 總杯數 (null when the day has no record).
export function withSales(events, records) {
  const map = Object.fromEntries(records.map((r) => [r.date, r]))
  return events.map((e) => ({ ...e, total: map[e.date]?.total ?? null, cups: map[e.date]?.cups ?? null }))
}
export const eventsOfYear = (events, year) => events.filter((e) => yearOf(e.date) === year)
export const eventsLike = (events, label) => events.filter((e) => eventKey(e.label) === eventKey(label)).sort((a, b) => (a.date < b.date ? 1 : -1))
export function eventYears(events) {
  return [...new Set(events.map((e) => yearOf(e.date)))].sort((a, b) => b - a)
}

// 週統計: average 總營業額 / 總杯數 per weekday (週一…週日) over the days that
// have a figure. `filter` = { year (number|null), quarter (1-4|null), month (1-12|null) }.
export function matchesPeriod(date, { year = null, quarter = null, month = null } = {}) {
  const m = monthOf(date)
  return (year === null || yearOf(date) === year) && (quarter === null || quarterOf(m) === quarter) && (month === null || m === month)
}
function avgOf(values) {
  const v = values.filter((x) => x !== null && x !== undefined)
  return v.length ? round2(sumOrNull(v) / v.length) : null
}
export function weekdayStats(records, filter) {
  return WEEKDAY_LABELS.map((label, i) => {
    const hit = records.filter((r) => weekdayIndex(r.date) === i && matchesPeriod(r.date, filter))
    return { key: i, label, days: hit.length, total: avgOf(hit.map((r) => r.total)), cups: avgOf(hit.map((r) => r.cups)) }
  })
}
// One weekday's average in every year (same quarter / month filter).
export function weekdayAcrossYears(records, index, filter) {
  return recordYears(records).map((y) => {
    const hit = records.filter((r) => weekdayIndex(r.date) === index && matchesPeriod(r.date, { ...filter, year: y }))
    return { year: y, days: hit.length, total: avgOf(hit.map((r) => r.total)), cups: avgOf(hit.map((r) => r.cups)) }
  })
}
