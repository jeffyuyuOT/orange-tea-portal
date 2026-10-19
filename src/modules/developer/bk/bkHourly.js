// Pure helpers for BK 小時統計: reading the two hourly Excel reports, the hours
// shown per store, and the per-hour maths. No Supabase / React here so it can be
// tested on its own.
import { round2, sumOrNull, toNum } from './bkUtils'
import { cellNumber, findHeaderRow, parseDateCell } from './bkImport'

export const DEFAULT_HOURS = { start: 9, end: 21 }
export const hourLabel = (h) => `${h}:00`

// ---------------------------------------------------------------------------
// Reading the reports. `rows` = the sheet as an array of arrays (SheetJS
// sheet_to_json header:1), so .xls and .xlsx both work.
// ---------------------------------------------------------------------------

const cellText = (c) => (c === null || c === undefined ? '' : String(c).trim())

// dd/mm/yyyy (or d/m/yy), yyyy-mm-dd, a Date or an Excel serial -> 'YYYY-MM-DD' | null
export function parseReportDate(v) {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

// 'pos' (POS "Sales By Hour"), 'self' (self-order "Store Performance Report") or null.
export function detectHourlyFile(rows) {
  const head = rows.slice(0, 15)
  if (head.some((r) => (r ?? []).some((c) => /sales\s*by\s*hour/i.test(cellText(c))))) return 'pos'
  if (head.some((r) => (r ?? []).some((c) => cellText(c) === 'Hour') && (r ?? []).some((c) => cellText(c) === 'Sales Amount'))) return 'self'
  return null
}

// POS report: one day only (the file has no per-day split, and no store name —
// the caller picks the store). -> { date, hours:[{hour,sales,count}] } | { error }
export function parsePosHourly(rows) {
  const periodIdx = rows.findIndex((r) => (r ?? []).some((c) => /for\s*period/i.test(cellText(c))))
  if (periodIdx < 0) return { error: '找不到 For Period（日期）。' }
  const dates = rows[periodIdx].map(parseReportDate).filter(Boolean)
  if (dates.length === 0) return { error: '讀不到報表日期。' }
  const from = dates[0]
  const to = dates[dates.length - 1]
  if (from !== to) return { error: `這份 POS 報表跨了多天（${from} 到 ${to}），每個小時是加總起來的，無法拆回每天。請每天分開匯出。` }
  const headIdx = rows.findIndex((r) => cellText(r?.[0]) === 'Hour')
  if (headIdx < 0) return { error: '找不到 Hour 欄。' }
  const head = rows[headIdx].map(cellText)
  const countCol = head.indexOf('Count')
  const salesCol = head.indexOf('Sales')
  if (salesCol < 0) return { error: '找不到 Sales 欄。' }
  const hours = []
  for (let i = headIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    if (cellText(r[0]).toLowerCase() === 'total') break
    const h = toNum(r[0])
    if (h === null || !Number.isInteger(h) || h < 0 || h > 23) continue
    const sales = toNum(r[salesCol])
    if (sales === null) continue
    hours.push({ hour: h, sales: round2(sales), count: countCol >= 0 ? toNum(r[countCol]) : null })
  }
  if (hours.length === 0) return { error: '報表裡沒有任何小時資料。' }
  return { date: from, hours }
}

// Self-order report (sheet "Hourly Sales"): any number of days; the store name is
// in each row. -> { rows:[{storeCode,storeName,date,hour,sales,count}] } | { error }
export function parseSelfHourly(rows) {
  const headIdx = rows.findIndex((r) => (r ?? []).some((c) => cellText(c) === 'Hour') && (r ?? []).some((c) => cellText(c) === 'Sales Amount'))
  if (headIdx < 0) return { error: '找不到 Hour / Sales Amount 欄。' }
  const head = rows[headIdx].map(cellText)
  const col = (name) => head.indexOf(name)
  const iCode = col('Store Code')
  const iName = col('Store Name')
  const iDate = col('Date')
  const iHour = col('Hour')
  const iSales = col('Sales Amount')
  const iCount = col('Order Count')
  if (iDate < 0) return { error: '找不到 Date 欄。' }
  const out = []
  for (let i = headIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const m = cellText(r[iHour]).match(/^(\d{1,2}):\d{2}$/)
    if (!m) continue // Store Total etc.
    const date = parseReportDate(r[iDate])
    const sales = toNum(r[iSales])
    if (!date || sales === null) continue
    out.push({
      storeCode: iCode >= 0 ? cellText(r[iCode]) : '',
      storeName: iName >= 0 ? cellText(r[iName]) : '',
      date,
      hour: Number(m[1]),
      sales: round2(sales),
      count: iCount >= 0 ? toNum(r[iCount]) : null,
    })
  }
  if (out.length === 0) return { error: '報表裡沒有任何小時資料。' }
  return { rows: out }
}

// Which bk_store a report's store name points at (exact name or code, ignoring case/space).
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '')
export function matchStore(stores, { storeName, storeCode }) {
  const n = norm(storeName)
  const c = norm(storeCode)
  return (
    stores.find((s) => n && norm(s.name) === n) ??
    stores.find((s) => c && norm(s.name) === c) ??
    stores.find((s) => n && (norm(s.name).includes(n) || n.includes(norm(s.name)))) ??
    null
  )
}

// Group parsed self-order rows into one job per (store name, date).
export function selfJobs(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = `${r.storeName}|${r.storeCode}|${r.date}`
    if (!map.has(key)) map.set(key, { storeName: r.storeName, storeCode: r.storeCode, date: r.date, hours: [] })
    map.get(key).hours.push({ hour: r.hour, sales: r.sales, count: r.count })
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export const sumHours = (hours) => round2(hours.reduce((s, h) => s + (h.sales ?? 0), 0))

// ---------------------------------------------------------------------------
// The 系統設置 › 匯入 sheet: one tab per store, rows = dates, columns = hours
// (already-summed 營業額). -> { days:{ [date]:{ [hour]: dollars } }, hours:[…],
// ignored:[…], unreadable, badCells } | { error }
// ---------------------------------------------------------------------------

// "9", 9, "9:00", "09:00", "9點", "9時" -> 9 ; anything else -> null
export function hourFromHeader(h) {
  if (typeof h === 'number') return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null
  if (h instanceof Date) return null
  const m = String(h ?? '').trim().match(/^(\d{1,2})(?::00)?\s*(?:點|时|時|h|hr)?$/i)
  if (!m) return null
  const n = Number(m[1])
  return n >= 0 && n <= 23 ? n : null
}

const SUMMARY_ROW = /^(total|sum|合計|總計|總和|平均|average|avg)/i

export function parseHourGridRows(rows) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { error: '找不到標題列：表頭需要有「日期」或「Date」欄。' }
  const headers = rows[headerIdx]
  const dateCol = headers.findIndex((h) => typeof h === 'string' && /^(date|日期|日)$/i.test(h.trim()))
  const hourCols = [] // [colIndex, hour]
  const ignored = []
  headers.forEach((h, i) => {
    if (i === dateCol || h === null || h === undefined || String(h).trim() === '') return
    const hour = hourFromHeader(h)
    if (hour === null) ignored.push(String(h).trim())
    else hourCols.push([i, hour])
  })
  if (hourCols.length === 0) return { error: '表頭裡找不到小時欄（例如 9:00、10:00）。' }
  const days = {}
  let unreadable = 0
  let badCells = 0
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    if (!row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) continue
    const dateCell = row[dateCol]
    if (typeof dateCell === 'string' && SUMMARY_ROW.test(dateCell.trim())) continue
    // a full date is required here (a bare day number can't say which month)
    const parsed = parseDateCell(dateCell, 1900, 1)
    if (!parsed || parsed.startsWith('1900-')) {
      unreadable++
      continue
    }
    const entry = {}
    for (const [i, hour] of hourCols) {
      const res = cellNumber(row[i])
      if (res.bad) badCells++
      if (res.value !== undefined) entry[hour] = round2(res.value)
    }
    if (Object.keys(entry).length > 0) days[parsed] = entry
  }
  const hours = [...new Set(hourCols.map(([, h]) => h))].sort((a, b) => a - b)
  return { days, hours, ignored, unreadable, badCells }
}

// ---------------------------------------------------------------------------
// Hours shown & per-hour maths
// ---------------------------------------------------------------------------

// { [storeId]: { start, end } } from bk_hour_settings rows.
export function settingsMap(rows) {
  const m = {}
  for (const r of rows) m[r.store_id] = { start: r.start_hour, end: r.end_hour }
  return m
}

// First..last hour shown for the chosen stores (the union when several).
export function hoursFor(settings, storeIds) {
  let start = 24
  let end = -1
  for (const id of storeIds) {
    const s = settings[id] ?? DEFAULT_HOURS
    start = Math.min(start, s.start)
    end = Math.max(end, s.end)
  }
  if (end < 0) return []
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

// One row's dollars = POS + self-order; a row that only has an imported
// already-summed figure (combined_sales, migration 0121) uses that instead.
export function rowSales(r) {
  const split = sumOrNull([toNum(r.pos_sales), toNum(r.self_sales)])
  return split !== null ? split : toNum(r.combined_sales)
}

// { [day]: { [hour]: dollars } } summed over the given stores.
export function hourlyByDay(rows, storeIds) {
  const ids = new Set(storeIds)
  const out = {}
  for (const r of rows) {
    if (!ids.has(r.store_id)) continue
    const v = rowSales(r)
    if (v === null) continue
    const day = (out[r.day] ??= {})
    day[r.hour] = round2((day[r.hour] ?? 0) + v)
  }
  return out
}

// Per-hour sum and per-hour average (a day with hourly data counts as 0 for an
// hour with no sales) over `days`; also each day's total and what falls outside `hours`.
export function gridStats(byDay, days, hours) {
  const shown = new Set(hours)
  const total = {}
  const average = {}
  const dayTotal = {}
  const dayOutside = {}
  let withData = 0
  let outsideAny = false
  for (const d of days) {
    const row = byDay[d]
    if (!row) continue
    withData++
    let all = 0
    let out = 0
    for (const [h, v] of Object.entries(row)) {
      all += v
      if (!shown.has(Number(h))) out += v
    }
    dayTotal[d] = round2(all)
    dayOutside[d] = round2(out)
    if (out !== 0) outsideAny = true
  }
  for (const h of hours) {
    let sum = 0
    for (const d of days) if (byDay[d]) sum += byDay[d][h] ?? 0
    total[h] = withData ? round2(sum) : null
    average[h] = withData ? round2(sum / withData) : null
  }
  const dayValues = Object.values(dayTotal)
  const grand = dayValues.length ? round2(dayValues.reduce((a, b) => a + b, 0)) : null
  return { total, average, dayTotal, dayOutside, outsideAny, withData, grand, avgDay: dayValues.length ? round2(grand / dayValues.length) : null }
}

// Average per hour over several days (history › 週統計); one day gives that day.
export function averageByHour(byDay, days) {
  const used = days.filter((d) => byDay[d])
  const hours = new Set()
  for (const d of used) for (const h of Object.keys(byDay[d])) hours.add(Number(h))
  const out = {}
  for (const h of [...hours].sort((a, b) => a - b)) out[h] = round2(used.reduce((s, d) => s + (byDay[d][h] ?? 0), 0) / used.length)
  return { values: out, days: used.length }
}
