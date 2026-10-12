// Pure helpers for the BK (記帳) page — date handling, number parsing and the
// Sales-figure / U帳 arithmetic. Kept free of React and Supabase so the maths
// can be tested on its own (and so the Excel export and the on-screen tables
// are guaranteed to use the same formulas).

export const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000

const pad2 = (n) => String(n).padStart(2, '0')

export function ymd(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// First day of the month AFTER (year, month), for half-open range queries.
export function nextMonthStart(year, month) {
  return month === 12 ? ymd(year + 1, 1, 1) : ymd(year, month + 1, 1)
}

export function monthStart(year, month) {
  return ymd(year, month, 1)
}

// Every date string of the month, 1st to last.
export function monthDates(year, month) {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => ymd(year, month, i + 1))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}
export function isWeekend(dateStr) {
  const w = weekdayOf(dateStr)
  return w === 'Sat' || w === 'Sun'
}

// "Today" in Brisbane (fixed UTC+10, no DST — same assumption as brisbaneTime.js).
export function brisbaneToday() {
  const b = new Date(Date.now() + BRISBANE_OFFSET_MS)
  return { year: b.getUTCFullYear(), month: b.getUTCMonth() + 1, day: b.getUTCDate() }
}
export function brisbaneTodayStr() {
  const t = brisbaneToday()
  return ymd(t.year, t.month, t.day)
}

export function prevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

export function monthLabel(year, month) {
  return `${year}-${pad2(month)}`
}

// '' / null / undefined / junk -> null, otherwise a finite number.
export function toNum(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// number -> text for an <input> (no thousands separators, no trailing zeros).
export function numToInput(n) {
  if (n === null || n === undefined) return ''
  return String(round2(Number(n)))
}

export function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return ''
  return round2(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Sum of the non-null numbers; null when there is nothing to sum.
export function sumOrNull(values) {
  let any = false
  let total = 0
  for (const v of values) {
    if (v === null || v === undefined) continue
    any = true
    total += v
  }
  return any ? round2(total) : null
}

// ---------------------------------------------------------------------------
// Sales figure
// ---------------------------------------------------------------------------

// Splits a store's payment types into ordered main columns (each with its
// ordered subs). Inactive types are dropped unless `keepIds` names them (a
// month that still holds data for a since-deactivated column keeps showing it).
export function buildColumns(types, keepIds = new Set()) {
  const visible = (t) => t.is_active || keepIds.has(t.id)
  const bySort = (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
  const mains = types.filter((t) => t.kind === 'main' && visible(t)).sort(bySort)
  return mains.map((main) => ({
    ...main,
    subs: types.filter((t) => t.kind === 'sub' && t.parent_id === main.id && visible(t)).sort(bySort),
  }))
}

// Ids of types that are inactive but hold a value somewhere in `days`
// ({ [date]: { amounts: { [typeId]: number|string } } }).
export function inactiveIdsWithData(types, days) {
  const used = new Set()
  for (const day of Object.values(days)) {
    for (const [id, v] of Object.entries(day.amounts ?? {})) {
      if (toNum(v) !== null) used.add(id)
    }
  }
  return new Set(types.filter((t) => !t.is_active && used.has(t.id)).map((t) => t.id))
}

// Cash is always O.CA − D (D = U帳's 未入庫 figure for that day); with no D it
// is simply O.CA. No O.CA -> no Cash.
export function cashValue(oCa, d) {
  if (oCa === null) return null
  return round2(oCa - (d ?? 0))
}

// One day's value for one main column.
//   Cash                -> computed (O.CA − D)
//   main made of subs   -> sum of its subs
//   any other main      -> what was typed in
export function mainValue(main, day, dValue) {
  if (main.is_locked && main.name === 'Cash') return cashValue(toNum(day.o_ca), dValue)
  if (main.subs.length > 0) return sumOrNull(main.subs.map((s) => toNum(day.amounts?.[s.id])))
  return toNum(day.amounts?.[main.id])
}

// Row maths for the Sales-figure table: each main's value, the sum of them,
// the typed-in Total and whether the two agree.
//   check: 'empty' (nothing on the day), 'ok', or 'bad'
export function computeSfDay(columns, day, dValue) {
  const mains = {}
  const subAmounts = {}
  for (const col of columns) {
    mains[col.id] = mainValue(col, day, dValue)
    for (const sub of col.subs) subAmounts[sub.id] = toNum(day.amounts?.[sub.id])
  }
  const sum = sumOrNull(Object.values(mains))
  const total = toNum(day.total)
  let check = 'empty'
  if (sum !== null || total !== null) {
    check = sum !== null && total !== null && Math.abs(sum - total) < 0.005 ? 'ok' : 'bad'
  }
  return { mains, subAmounts, sum, total, check, oCa: toNum(day.o_ca) }
}

// Column totals for the bottom row.
export function computeSfTotals(columns, rows) {
  const mains = {}
  for (const col of columns) mains[col.id] = sumOrNull(rows.map((r) => r.mains[col.id]))
  const subs = {}
  for (const col of columns) {
    for (const sub of col.subs) subs[sub.id] = sumOrNull(rows.map((r) => r.subAmounts?.[sub.id] ?? null))
  }
  return {
    mains,
    subs,
    sum: sumOrNull(rows.map((r) => r.sum)),
    total: sumOrNull(rows.map((r) => r.total)),
    oCa: sumOrNull(rows.map((r) => r.oCa)),
  }
}

// Submit rule: every day of the month needs a Cash figure (i.e. O.CA) and a
// Total. Returns the dates that fail, with what's missing, for the warning.
export function sfSubmitProblems(dates, days) {
  const problems = []
  for (const date of dates) {
    const day = days[date] ?? {}
    const missing = []
    if (toNum(day.o_ca) === null) missing.push('Cash')
    if (toNum(day.total) === null) missing.push('Total')
    if (missing.length) problems.push({ date, missing })
  }
  return problems
}

// DB rows -> the string-valued form state the sheet edits.
export function sfDaysFromRows(rows) {
  const map = {}
  for (const d of rows) {
    map[d.day] = {
      o_ca: numToInput(d.o_ca),
      total: numToInput(d.total),
      amounts: Object.fromEntries(Object.entries(d.amounts ?? {}).map(([k, v]) => [k, numToInput(v)])),
    }
  }
  return map
}

// bk_cash_days rows -> { [date]: D amount }
export function dMapFromRows(rows) {
  const map = {}
  for (const r of rows) map[r.day] = toNum(r.d_amount)
  return map
}

// True when a day holds nothing worth saving.
export function isEmptySfDay(day) {
  if (toNum(day.o_ca) !== null || toNum(day.total) !== null) return false
  return !Object.values(day.amounts ?? {}).some((v) => toNum(v) !== null)
}

// ---------------------------------------------------------------------------
// U帳 (store cash)
// ---------------------------------------------------------------------------

export const ENTRY_KIND_LABELS = {
  icost: 'Icost',
  ucost: 'Ucost',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  ruju: '入金',
}
export const RUJU_TARGET_LABELS = { jeff_bank: '入 Jeff bank', mao_safe: '入 Mao 保險箱', other: '其他' }

// Per-day rows of the 分店現金 table.
//   oCa      from the Sales-figure sheet (same store, same date)
//   actual   實 CA, typed
//   pm       +/−  = 實 CA − O.CA  (only once 實 CA is typed)
//   d        D 欄, typed
//   sfCash   = O.CA − D
export function computeCashDay(oCa, cashDay) {
  const o = toNum(oCa)
  const actual = toNum(cashDay?.actual_ca)
  const d = toNum(cashDay?.d_amount)
  return {
    oCa: o,
    actual,
    pm: actual === null ? null : round2(actual - (o ?? 0)),
    d,
    stocked: !!cashDay?.d_stocked,
    sfCash: cashValue(o, d),
  }
}

// The four header numbers + column totals for one month.
//   COH  = opening COH  + Σ SF cash − Σ deposit + Σ withdraw − Σ Icost
//   UCOH = opening UCOH + Σ D + Σ(+/−) − Σ Ucost − Σ 入金
//   D    = Σ D of days whose 入庫 is NOT ticked
//   P/L  = Σ D + Σ(+/−) − Σ Ucost
export function computeCashSummary(openCoh, openUcoh, dayRows, entries) {
  const sum = (arr) => round2(arr.reduce((a, b) => a + (b ?? 0), 0))
  const kindSum = (kind) => sum(entries.filter((e) => e.kind === kind).map((e) => toNum(e.amount)))
  const dep = kindSum('deposit')
  const wd = kindSum('withdraw')
  const icost = kindSum('icost')
  const ucost = kindSum('ucost')
  const ruju = kindSum('ruju')
  const oCaT = sum(dayRows.map((r) => r.oCa))
  const actualT = sum(dayRows.map((r) => r.actual))
  const pmT = sum(dayRows.map((r) => r.pm))
  const dT = sum(dayRows.map((r) => r.d))
  const sfCashT = sum(dayRows.map((r) => r.sfCash))
  const dUnstocked = sum(dayRows.filter((r) => !r.stocked).map((r) => r.d))
  return {
    coh: round2(openCoh + sfCashT - dep + wd - icost),
    ucoh: round2(openUcoh + dT + pmT - ucost - ruju),
    dUnstocked,
    pl: round2(dT + pmT - ucost),
    totals: { oCa: oCaT, actual: actualT, pm: pmT, d: dT, sfCash: sfCashT },
    entryTotals: { deposit: dep, withdraw: wd, dw: round2(dep - wd), icost, ucost, ruju },
  }
}

// Ticking 入庫 on a day also ticks every earlier day of the month; un-ticking
// a day un-ticks every later one, so the ticks always form a prefix.
export function toggleStocked(dates, current, date, checked) {
  const next = { ...current }
  for (const d of dates) {
    if (checked && d <= date) next[d] = true
    if (!checked && d >= date) next[d] = false
  }
  return next
}

// bk_sf_days rows -> { [date]: O.CA number }
export function sfOcaMapFromRows(rows) {
  const map = {}
  for (const r of rows) map[r.day] = toNum(r.o_ca)
  return map
}

// bk_cash_days rows -> { [date]: form-state row (strings + boolean) }
export function cashDaysFromRows(rows) {
  const map = {}
  for (const r of rows) {
    map[r.day] = { actual_ca: numToInput(r.actual_ca), d_amount: numToInput(r.d_amount), d_stocked: !!r.d_stocked }
  }
  return map
}

export function isEmptyCashDay(row) {
  return toNum(row.actual_ca) === null && toNum(row.d_amount) === null && !row.d_stocked
}

// Signed amount as shown in the D/W block (deposit +, withdraw −).
export function dwSigned(entry) {
  const a = toNum(entry.amount) ?? 0
  return entry.kind === 'withdraw' ? -a : a
}
