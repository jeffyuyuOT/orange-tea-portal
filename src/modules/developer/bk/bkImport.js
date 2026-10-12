// Excel import for the Sales-figure sheet. Pure parsing — turns the rows of a
// worksheet into per-day values for the month on screen; nothing is written
// to the database here (the sheet stays editable and unsaved until 儲存).
//
// Columns are matched by their HEADER NAME, not position, so the file this
// page exports (Date | mains | Total | Sum vs Total | subs | O.CA) imports
// straight back, and another file with the same column names works too:
//   Date / 日期          which day (a date, "2026-10-05", "5/10/2026", "5 Mon" or a plain day number)
//   O.CA                 -> O.CA
//   Cash                 -> O.CA, but only if the file has no O.CA column
//                           (the spec: the report's cash figure goes into O.CA;
//                           the sheet's own Cash is O.CA − D and is never typed)
//   Total                -> Total
//   <payment type name>  -> that column; sub columns may carry a " (Parent)" suffix
//   Sum vs Total         ignored (it's a check)
//   a main made of subs  ignored (computed from its subs)
import { daysInMonth, toNum, ymd } from './bkUtils'

const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// "POS eftpos (Total Eftpos)" -> "pos eftpos"
const normHeader = (s) => norm(String(s ?? '').replace(/\s*\([^)]*\)\s*$/, ''))

// exceljs cell value -> plain string | number | Date | null
function plain(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('result' in v) return plain(v.result) // formula
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if (typeof v.text === 'string') return v.text // hyperlink
    return null // error values etc.
  }
  return v
}

// First worksheet that has a header row -> rows as arrays (index 0 = column A).
export async function readWorkbookRows(arrayBuffer) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const sheets = wb.worksheets.map((ws) => {
    const rows = []
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const out = []
      for (let c = 1; c <= row.cellCount; c++) out.push(plain(row.getCell(c).value))
      rows[rowNumber - 1] = out
    })
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) }
  })
  return sheets.find((s) => findHeaderRow(s.rows) >= 0) ?? sheets[0] ?? { name: '', rows: [] }
}

const DATE_HEADERS = new Set(['date', '日期', '日'])

export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 25)
  for (let i = 0; i < limit; i++) {
    if ((rows[i] ?? []).some((c) => typeof c === 'string' && DATE_HEADERS.has(norm(c)))) return i
  }
  return -1
}

function validDate(y, m, d) {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? ymd(y, m, d) : null
}

// -> 'YYYY-MM-DD' | null.  A bare day number (1–31) means that day of the
// month being imported into.
export function parseDateCell(v, year, month) {
  if (v instanceof Date) return validDate(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 1 && v <= 31) return validDate(year, month, v)
    if (v >= 20000) {   // Excel date serial (20000 ≈ 1954); smaller numbers aren't dates
      const d = new Date(Math.round((v - 25569) * 86400000)) // Excel serial -> UTC date
      return validDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
    return null
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]))
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/) // day first (Australian)
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]))
  m = s.match(/^(\d{1,2})(?:\D|$)/) // "5", "5 Mon", "5日"
  if (m) return validDate(year, month, Number(m[1]))
  return null
}

function cellNumber(v) {
  if (v === null || v === undefined || v === '') return { empty: true }
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : { bad: true }
  if (typeof v === 'string') {
    const t = v.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1') // (12.5) = −12.5
    if (t === '' || t === '-') return { empty: true }
    const n = toNum(t)
    return n === null ? { bad: true } : { value: n }
  }
  return { bad: true }
}

const SUMMARY_LABELS = /^(total|sum|合計|總計|總和)\b/i

// rows: array of arrays. columns: the sheet's buildColumns() result (mains with .subs).
// Returns {
//   error?, entries: { [date]: { o_ca?, total?, amounts: { [typeId]: number } } },
//   mapped: [{ header, target }], ignored: [{ header, reason }],
//   otherMonths: ['2026-09', …], unreadable: n, badCells: n, notes: [..], dayCount, cellCount
// }
export function parseSfRows(rows, { year, month, columns }) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) {
    return { error: '找不到標題列：檔案的第一個表頭需要有「Date」或「日期」欄。', entries: {}, mapped: [], ignored: [], otherMonths: [], unreadable: 0, badCells: 0, notes: [], dayCount: 0, cellCount: 0 }
  }
  const headers = rows[headerIdx]

  // Which sheet columns can be typed into, by normalised name.
  const typed = new Map() // name -> { id, label }
  const computed = new Map() // name -> reason
  for (const col of columns) {
    if (col.is_locked && col.name === 'Cash') computed.set(norm(col.name), 'Cash = O.CA − D，由系統計算')
    else if (col.subs.length > 0) {
      computed.set(norm(col.name), '由 sub payment type 加總，請匯入它的 sub 欄位')
      for (const sub of col.subs) typed.set(norm(sub.name), { id: sub.id, label: `${sub.name}（${col.name}）` })
    } else typed.set(norm(col.name), { id: col.id, label: col.name })
  }

  const hasOca = headers.some((h) => typeof h === 'string' && ['o.ca', 'oca', 'o ca'].includes(normHeader(h)))
  const targets = [] // index -> { kind, ... } | undefined
  const mapped = []
  const ignored = []
  const notes = []
  let dateCol = -1
  headers.forEach((h, i) => {
    if (h === null || h === undefined || String(h).trim() === '') return
    const label = String(h).replace(/\s+/g, ' ').trim()
    const n = normHeader(h)
    if (DATE_HEADERS.has(norm(h)) && dateCol < 0) {
      dateCol = i
    } else if (['o.ca', 'oca', 'o ca'].includes(n)) {
      targets[i] = { kind: 'o_ca' }
      mapped.push({ header: label, target: 'O.CA' })
    } else if (n === 'cash' && !hasOca) {
      targets[i] = { kind: 'o_ca' }
      mapped.push({ header: label, target: 'O.CA（檔案沒有 O.CA 欄，Cash 當作 O.CA）' })
      notes.push('檔案沒有 O.CA 欄，已把「Cash」欄當作 O.CA 匯入。')
    } else if (n === 'total') {
      targets[i] = { kind: 'total' }
      mapped.push({ header: label, target: 'Total' })
    } else if (n === 'sum vs total') {
      ignored.push({ header: label, reason: '檢查欄，不匯入' })
    } else if (typed.has(n)) {
      targets[i] = { kind: 'amount', id: typed.get(n).id }
      mapped.push({ header: label, target: typed.get(n).label })
    } else if (computed.has(n)) {
      ignored.push({ header: label, reason: computed.get(n) })
    } else {
      ignored.push({ header: label, reason: '這間分店沒有這個 payment type' })
    }
  })
  if (dateCol < 0) dateCol = headers.findIndex((h) => typeof h === 'string' && DATE_HEADERS.has(norm(h)))

  const entries = {}
  const otherMonths = new Set()
  let unreadable = 0
  let badCells = 0
  let cellCount = 0
  let duplicateDays = 0

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const hasContent = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')
    if (!hasContent) continue
    const dateCell = row[dateCol]
    if (typeof dateCell === 'string' && SUMMARY_LABELS.test(dateCell.trim())) continue // the file's own Total row
    const date = parseDateCell(dateCell, year, month)
    if (!date) {
      unreadable++
      continue
    }
    if (date.slice(0, 7) !== `${year}-${String(month).padStart(2, '0')}`) {
      otherMonths.add(date.slice(0, 7))
      continue
    }
    const entry = entries[date] ?? { amounts: {} }
    if (entries[date]) duplicateDays++
    let any = false
    targets.forEach((t, i) => {
      if (!t) return
      const res = cellNumber(row[i])
      if (res.bad) badCells++
      if (res.value === undefined) return
      any = true
      cellCount++
      if (t.kind === 'o_ca') entry.o_ca = res.value
      else if (t.kind === 'total') entry.total = res.value
      else entry.amounts[t.id] = res.value
    })
    if (any) entries[date] = entry
  }
  if (duplicateDays) notes.push(`有 ${duplicateDays} 天在檔案裡出現不只一次，以後面那一列為準。`)

  return {
    entries,
    mapped,
    ignored,
    otherMonths: [...otherMonths].sort(),
    unreadable,
    badCells,
    notes,
    dayCount: Object.keys(entries).length,
    cellCount,
  }
}

// How many cells already holding a different number would be replaced.
// `days` is the sheet's form state ({ [date]: { o_ca, total, amounts } } of strings).
export function countOverwrites(entries, days) {
  let n = 0
  const differs = (existing, incoming) => {
    const e = toNum(existing)
    return e !== null && Math.abs(e - incoming) > 0.004
  }
  for (const [date, entry] of Object.entries(entries)) {
    const cur = days[date]
    if (!cur) continue
    if (entry.o_ca !== undefined && differs(cur.o_ca, entry.o_ca)) n++
    if (entry.total !== undefined && differs(cur.total, entry.total)) n++
    for (const [id, v] of Object.entries(entry.amounts)) if (differs(cur.amounts?.[id], v)) n++
  }
  return n
}
