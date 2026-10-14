// Pure helpers for the BK 營業 tab — the daily takings sheet (POS / CV / Self O
// and the cup counts). Kept free of React and Supabase, like bkUtils.js, so the
// on-screen table and both Excel exports are guaranteed to use the same maths.
import { monthDates, round2, sumOrNull, toNum, weekdayOf, ymd } from './bkUtils'

// CV is a count that is worth 4 each in the takings.
export const CV_MULTIPLIER = 4

// The manual fields, in the order they appear after 日期 / 總營業額 / 總杯數.
// `field` is the bk_sales_days column, `key` the computed-row key.
export const BIZ_INPUTS = [
  { key: 'pCups', field: 'p_cups', label: 'P杯數', money: false },
  { key: 'pos', field: 'pos', label: 'POS', money: true },
  { key: 'cv', field: 'cv', label: 'CV', money: false },
  { key: 'selfO', field: 'self_o', label: 'Self O', money: true },
  { key: 'soCups', field: 'so_cups', label: 'SO杯數', money: false },
]

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

export const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

// Every date from `from` to `to`, inclusive ([] when the range is backwards).
export function datesBetween(from, to) {
  const out = []
  if (!isDateStr(from) || !isDateStr(to) || from > to) return out
  for (let d = from; d <= to && out.length < 1000; d = addDays(d, 1)) out.push(d)
  return out
}

export const isMonday = (dateStr) => weekdayOf(dateStr) === 'Mon'

// The Monday on or before `dateStr`.
export function mondayOnOrBefore(dateStr) {
  const order = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
  return addDays(dateStr, -order[weekdayOf(dateStr)])
}

export function lastDayOfMonth(year, month) {
  return monthDates(year, month).at(-1)
}

// 28/09/2026 — the date style in the weekly report.
export function dmy(dateStr) {
  const [y, m, d] = dateStr.split('-')
  return `${Number(d)}/${m}/${y}`
}

// ---------------------------------------------------------------------------
// Row maths
// ---------------------------------------------------------------------------

// One day's figures. `day` is the stored row ({ pos, self_o, cv, p_cups,
// so_cups }, numbers or strings). `sfPost`: for a store linked to SF, that
// day's O.POST from SF (number or null) — it REPLACES the typed POS; pass
// undefined for a store whose POS is typed by hand.
//   總營業額 = POS + Self O + CV × 4
//   總杯數   = P杯數 + SO杯數
export function bizDayRow(day, sfPost) {
  const pos = sfPost !== undefined ? toNum(sfPost) : toNum(day?.pos)
  const selfO = toNum(day?.self_o)
  const cv = toNum(day?.cv)
  const pCups = toNum(day?.p_cups)
  const soCups = toNum(day?.so_cups)
  return {
    pos,
    selfO,
    cv,
    pCups,
    soCups,
    total: sumOrNull([pos, selfO, cv === null ? null : round2(cv * CV_MULTIPLIER)]),
    cups: sumOrNull([pCups, soCups]),
  }
}

export const BIZ_COLUMNS = ['total', 'cups', 'pCups', 'pos', 'cv', 'selfO', 'soCups']

// Bottom rows. Total = column sum. Average = that sum over the days in the
// range that HAVE a figure in the column (so a month still in progress is
// averaged over the days entered so far, not the whole month).
export function bizTotals(rows) {
  const total = {}
  const average = {}
  for (const key of BIZ_COLUMNS) {
    const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined)
    total[key] = sumOrNull(values)
    average[key] = values.length ? round2(sumOrNull(values) / values.length) : null
  }
  return { total, average }
}

// DB rows -> { [date]: { pos, self_o, cv, p_cups, so_cups } } as input strings.
export function bizDaysFromRows(rows) {
  const map = {}
  for (const r of rows) {
    map[r.day] = {
      // money fields keep two decimals (POS, Self O); CV and the cup counts stay plain numbers
      pos: r.pos === null || r.pos === undefined ? '' : round2(Number(r.pos)).toFixed(2),
      self_o: r.self_o === null || r.self_o === undefined ? '' : round2(Number(r.self_o)).toFixed(2),
      cv: r.cv === null || r.cv === undefined ? '' : String(round2(Number(r.cv))),
      p_cups: r.p_cups === null || r.p_cups === undefined ? '' : String(round2(Number(r.p_cups))),
      so_cups: r.so_cups === null || r.so_cups === undefined ? '' : String(round2(Number(r.so_cups))),
    }
  }
  return map
}

// True when none of the typed fields holds a number. `skipPos`: a linked
// store's POS is not typed here, so it doesn't count.
export function isEmptyBizDay(day, skipPos = false) {
  if (!day) return true
  return BIZ_INPUTS.every(({ field }) => (skipPos && field === 'pos') || toNum(day[field]) === null)
}

// { [date]: Self O number|null } from stored rows — what SF's kiosk column reads.
export function selfOMapFromRows(rows) {
  const map = {}
  for (const r of rows) map[r.day] = toNum(r.self_o)
  return map
}

// { [date]: O.POST number|null } from bk_sf_days rows.
export function postMapFromRows(rows) {
  const map = {}
  for (const r of rows) map[r.day] = toNum(r.o_post)
  return map
}
