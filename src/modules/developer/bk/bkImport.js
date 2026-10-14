// Excel import for the Sales-figure sheet. Pure parsing — turns the rows of a
// worksheet into per-day values for the month on screen; nothing is written
// to the database here (the sheet stays editable and unsaved until 儲存).
//
// Columns are matched by their HEADER NAME, not position, so the file this
// page exports (Date | mains | Total | Sum vs Total | subs | O.CA) imports
// straight back, and another file with the same column names works too:
//   Date / 日期          which day (a date, "2026-10-05", "5/10/2026", "5 Mon" or a plain day number)
//   O.CA                 -> O.CA
//   O.POST               -> O.POST (the POS report's total)
//   Pos total            ignored (= O.POST − D, calculated by the sheet)
//   Cash                 -> O.CA, but only if the file has no O.CA column
//                           (the spec: the report's cash figure goes into O.CA;
//                           the sheet's own Cash is O.CA − D and is never typed)
//   Total                ignored (Total = Pos total + Self order kiosk, calculated by the sheet)
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

async function loadWorkbookSheets(arrayBuffer) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  return wb.worksheets.map((ws) => {
    const rows = []
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const out = []
      for (let c = 1; c <= row.cellCount; c++) out.push(plain(row.getCell(c).value))
      rows[rowNumber - 1] = out
    })
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) }
  })
}

// Worksheet that has a header row -> rows as arrays (index 0 = column A).
// Normally picks the first sheet with a recognizable header row (or the
// workbook's first sheet). When `sheetNames` is given (系統設置's U帳 import,
// whose template has both a 分店現金 and a 收支 sheet in one file), restricts
// the search to worksheets whose name matches one of those strings, so the
// caller can pick out a specific sheet instead of whichever comes first.
export async function readWorkbookRows(arrayBuffer, { sheetNames } = {}) {
  const sheets = await loadWorkbookSheets(arrayBuffer)
  const pool = sheetNames?.length ? sheets.filter((s) => sheetNames.includes(s.name)) : sheets
  return pool.find((s) => findHeaderRow(s.rows) >= 0) ?? pool[0] ?? sheets[0] ?? { name: '', rows: [] }
}

// Just the worksheet names, for 系統設置's U帳 dispatcher to decide which of
// 分店現金 / 收支 (or both) are present in an uploaded file before it reads
// either one in full.
export async function listWorkbookSheetNames(arrayBuffer) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  return wb.worksheets.map((ws) => ws.name)
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

export function cellNumber(v) {
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
//   error?, entries: { [date]: { o_ca?, o_post?, amounts: { [typeId]: number } } },
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
    if (col.name === 'Cash') computed.set(norm(col.name), 'Cash = O.CA − D，由系統計算')
    else if (col.name === 'Pos total') computed.set(norm(col.name), 'Pos total = O.POST − D，由系統計算，請匯入 O.POST')
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
    } else if (['o.post', 'opost', 'o post'].includes(n)) {
      targets[i] = { kind: 'o_post' }
      mapped.push({ header: label, target: 'O.POST' })
    } else if (n === 'cash' && !hasOca) {
      targets[i] = { kind: 'o_ca' }
      mapped.push({ header: label, target: 'O.CA（檔案沒有 O.CA 欄，Cash 當作 O.CA）' })
      notes.push('檔案沒有 O.CA 欄，已把「Cash」欄當作 O.CA 匯入。')
    } else if (n === 'total') {
      ignored.push({ header: label, reason: 'Total 由 Pos total + Self order kiosk 自動計算，不匯入' })
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
      else if (t.kind === 'o_post') entry.o_post = res.value
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
// `days` is the sheet's form state ({ [date]: { o_ca, o_post, total, amounts } } of strings).
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
    if (entry.o_post !== undefined && differs(cur.o_post, entry.o_post)) n++
    if (entry.total !== undefined && differs(cur.total, entry.total)) n++
    for (const [id, v] of Object.entries(entry.amounts)) if (differs(cur.amounts?.[id], v)) n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Point 5: backfill-by-Excel for the other three BK surfaces (Sales figure's
// own import is parseSfRows above). The shared rule across all four: a cell
// / row the system already has wins — the import only fills gaps — unless
// the person explicitly turns that off for a sheet-style import.
// ---------------------------------------------------------------------------

// Strip out of a parseSfRows() result any field whose cell in `days` (the SF
// sheet's current, unsaved state) already holds a value, so 套用 only fills
// gaps. Returns { entries, skipped } — `skipped` is how many fields were
// left alone because the sheet already had something there.
export function filterKeepExisting(entries, days) {
  const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== ''
  const out = {}
  let skipped = 0
  for (const [date, entry] of Object.entries(entries)) {
    const cur = days[date]
    const next = { amounts: {} }
    let any = false
    for (const field of ['o_ca', 'o_post', 'total']) {
      if (entry[field] === undefined) continue
      if (cur && hasValue(cur[field])) skipped++
      else {
        next[field] = entry[field]
        any = true
      }
    }
    for (const [id, v] of Object.entries(entry.amounts ?? {})) {
      if (cur && hasValue(cur.amounts?.[id])) skipped++
      else {
        next.amounts[id] = v
        any = true
      }
    }
    if (any) out[date] = next
  }
  return { entries: out, skipped }
}

// Same idea for 分店現金's daily grid (actual_ca / d_amount / d_stocked).
// 入庫 is never un-ticked by an import — only ever ticked, same "only fill
// gaps" spirit since un-ticking has the cascading effect toggleStocked() uses.
export function filterKeepExistingCashDays(entries, cashDays) {
  const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== ''
  const out = {}
  let skipped = 0
  for (const [date, entry] of Object.entries(entries)) {
    const cur = cashDays[date]
    const next = {}
    let any = false
    for (const field of ['actual_ca', 'd_amount']) {
      if (entry[field] === undefined) continue
      if (cur && hasValue(cur[field])) skipped++
      else {
        next[field] = entry[field]
        any = true
      }
    }
    if (entry.d_stocked !== undefined) {
      if (cur?.d_stocked) skipped++
      else {
        next.d_stocked = entry.d_stocked
        any = true
      }
    }
    if (any) out[date] = next
  }
  return { entries: out, skipped }
}

const ACTUAL_CA_HEADERS = new Set(['實ca', '實際ca', 'actual ca', 'actualca'])
const D_AMOUNT_HEADERS = new Set(['d', 'd欄', 'd 欄', 'd amount'])
const STOCKED_HEADERS = new Set(['入庫', 'stocked', 'd_stocked'])
const TRUE_WORDS = new Set(['1', 'true', 'yes', 'y', '是', '✓', 'v'])

function parseBoolCell(v) {
  if (v === null || v === undefined || String(v).trim() === '') return undefined
  return TRUE_WORDS.has(norm(v))
}

// U帳 > 分店現金's daily grid: Date / 實CA / D / 入庫. Same month-scoped shape
// as parseSfRows (the grid is one month at a time).
export function parseCashDayRows(rows, { year, month }) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) {
    return { error: '找不到標題列：檔案的第一個表頭需要有「Date」或「日期」欄。', entries: {}, mapped: [], ignored: [], otherMonths: [], unreadable: 0, badCells: 0, notes: [], dayCount: 0, cellCount: 0 }
  }
  const headers = rows[headerIdx]
  const targets = []
  const mapped = []
  const ignored = []
  let dateCol = -1
  headers.forEach((h, i) => {
    if (h === null || h === undefined || String(h).trim() === '') return
    const label = String(h).replace(/\s+/g, ' ').trim()
    const n = normHeader(h)
    if (DATE_HEADERS.has(norm(h)) && dateCol < 0) dateCol = i
    else if (ACTUAL_CA_HEADERS.has(n)) {
      targets[i] = { kind: 'actual_ca' }
      mapped.push({ header: label, target: '實 CA' })
    } else if (D_AMOUNT_HEADERS.has(n)) {
      targets[i] = { kind: 'd_amount' }
      mapped.push({ header: label, target: 'D' })
    } else if (STOCKED_HEADERS.has(n)) {
      targets[i] = { kind: 'd_stocked' }
      mapped.push({ header: label, target: '入庫' })
    } else ignored.push({ header: label, reason: '沒有對應的欄位（需要 實CA / D / 入庫）' })
  })
  if (dateCol < 0) dateCol = headers.findIndex((h) => typeof h === 'string' && DATE_HEADERS.has(norm(h)))
  if (dateCol < 0) return { error: '找不到「Date」或「日期」欄。', entries: {}, mapped, ignored, otherMonths: [], unreadable: 0, badCells: 0, notes: [], dayCount: 0, cellCount: 0 }

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
    if (typeof dateCell === 'string' && SUMMARY_LABELS.test(dateCell.trim())) continue
    const date = parseDateCell(dateCell, year, month)
    if (!date) {
      unreadable++
      continue
    }
    if (date.slice(0, 7) !== `${year}-${String(month).padStart(2, '0')}`) {
      otherMonths.add(date.slice(0, 7))
      continue
    }
    const entry = entries[date] ?? {}
    if (entries[date]) duplicateDays++
    let any = false
    targets.forEach((t, i) => {
      if (!t) return
      if (t.kind === 'd_stocked') {
        const b = parseBoolCell(row[i])
        if (b === undefined) return
        entry.d_stocked = b
        any = true
        cellCount++
        return
      }
      const res = cellNumber(row[i])
      if (res.bad) badCells++
      if (res.value === undefined) return
      entry[t.kind] = res.value
      any = true
      cellCount++
    })
    if (any) entries[date] = entry
  }
  const notes = []
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

// 分店現金 files carry a Store column (the downloadable template does), so the
// store comes from each row, not from a picker. Splits a sheet's rows into one
// group per known store (each group still has the header rows on top, ready for
// parseCashDayRows). Rows whose store is blank or not in `stores` are counted in
// `unknown` and never imported. `hasStoreColumn` false = old-style file with no
// Store column (the caller must then ask which store it is for).
export function splitCashRowsByStore(rows, stores) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { hasStoreColumn: false, groups: [], unknown: [] }
  const headers = rows[headerIdx]
  const storeCol = headers.findIndex((h) => typeof h === 'string' && ['store', '分店'].includes(norm(h)))
  if (storeCol < 0) return { hasStoreColumn: false, groups: [], unknown: [] }
  const dateCol = headers.findIndex((h) => typeof h === 'string' && DATE_HEADERS.has(norm(h)))
  const head = rows.slice(0, headerIdx + 1)
  const groups = new Map() // store id -> { store, rows }
  const unknown = new Map() // name -> count
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    if (!row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) continue
    const dateCell = row[dateCol]
    if (typeof dateCell === 'string' && SUMMARY_LABELS.test(dateCell.trim())) continue
    const store = findStoreByName(stores, row[storeCol])
    if (!store) {
      const name = String(row[storeCol] ?? '').trim() || '（空白）'
      unknown.set(name, (unknown.get(name) ?? 0) + 1)
      continue
    }
    if (!groups.has(store.id)) groups.set(store.id, { store, rows: [...head] })
    groups.get(store.id).rows.push(row)
  }
  return {
    hasStoreColumn: true,
    groups: [...groups.values()],
    unknown: [...unknown].map(([name, count]) => ({ name, count })),
  }
}

// U帳 > 收支 (the ledger) and 分店transfer. Not month-scoped — each row
// carries its own date, and rows are independent records rather than a
// per-day grid, so parsing produces a flat candidate list instead of an
// `entries` map; duplicate-checking against the DB happens separately
// (markLedgerDuplicates) once the caller has fetched the relevant range.
const LEDGER_KIND_ALIASES = [
  ['icost', ['icost']],
  ['ucost', ['ucost']],
  ['other_income', ['其他收入', 'other income', 'otherincome', 'income']],
  ['deposit', ['deposit', '存入', '入帳']],
  ['withdraw', ['withdraw', '提出', '提款']],
  ['ruju', ['入金', 'ruju']],
  ['transfer', ['分店transfer', 'transfer', 'store transfer', '分店 transfer']],
]
function parseLedgerKindCell(v) {
  const n = norm(v)
  for (const [kind, aliases] of LEDGER_KIND_ALIASES) if (aliases.includes(n)) return kind
  return null
}
const RUJU_TARGET_ALIASES = {
  jeff_bank: ['jeff bank', 'jeff', 'jeffbank', '入jeff bank', '入 jeff bank'],
  mao_safe: ['mao safe', 'mao保', 'mao', '入mao保', '入 mao 保險箱', 'mao保险箱', 'mao 保險箱'],
  other: ['其他', 'other'],
}
function parseRujuTargetCell(v) {
  const n = norm(v)
  for (const [k, aliases] of Object.entries(RUJU_TARGET_ALIASES)) if (aliases.includes(n)) return k
  return null
}
function findStoreByName(stores, name) {
  if (name === null || name === undefined || String(name).trim() === '') return null
  const n = norm(name)
  return stores.find((s) => norm(s.name) === n) ?? null
}

const LEDGER_HEADER_MAP = [
  ['date', ['date', '日期', '日']],
  ['store', ['store', '分店']],
  ['kind', ['type', 'kind', '種類', '類型']],
  ['amount', ['amount', '金額']],
  ['desc', ['description', 'desc', '說明', '敘述']],
  ['note', ['note', '附註', '備註']],
  ['target', ['target', '入金對象', '對象']],
  ['from', ['from', 'from店', 'from分店', 'from store']],
  ['to', ['to', 'to店', 'to分店', 'to store']],
  ['mode', ['mode', '借貸或償還', '借貸償還']],
]

export function parseLedgerRows(rows, { stores, defaultStoreId }) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { error: '找不到標題列：檔案需要有「Date」或「日期」欄。', rows: [], mapped: [], ignored: [] }
  const headers = rows[headerIdx]
  const col = {}
  const mapped = []
  const ignored = []
  headers.forEach((h, i) => {
    if (h === null || h === undefined || String(h).trim() === '') return
    const label = String(h).replace(/\s+/g, ' ').trim()
    const n = normHeader(h)
    const hit = LEDGER_HEADER_MAP.find(([key, aliases]) => col[key] === undefined && aliases.includes(n))
    if (hit) {
      col[hit[0]] = i
      mapped.push({ header: label, target: hit[0] })
    } else ignored.push({ header: label, reason: '沒有對應的欄位' })
  })
  if (col.date === undefined) return { error: '找不到「Date」或「日期」欄。', rows: [], mapped, ignored }
  if (col.kind === undefined) return { error: '找不到「Type」或「種類」欄。', rows: [], mapped, ignored }
  if (col.amount === undefined) return { error: '找不到「Amount」或「金額」欄。', rows: [], mapped, ignored }

  const out = []
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const hasContent = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')
    if (!hasContent) continue
    const rowNumber = r + 1
    const date = parseDateCell(row[col.date], 0, 0) // no implied month: bare day numbers are rejected
    if (!date) {
      out.push({ rowNumber, problem: '日期看不懂（需要完整日期，例如 2026-10-05）' })
      continue
    }
    const kind = parseLedgerKindCell(row[col.kind])
    if (!kind) {
      out.push({ rowNumber, date, problem: `看不懂的種類：「${row[col.kind] ?? ''}」` })
      continue
    }
    const amtRes = cellNumber(row[col.amount])
    if (amtRes.bad || amtRes.value === undefined) {
      out.push({ rowNumber, date, kind, problem: '金額看不懂' })
      continue
    }
    const amount = amtRes.value
    if (amount === 0) {
      out.push({ rowNumber, date, kind, problem: '金額不能是 0' })
      continue
    }
    if (['deposit', 'withdraw', 'other_income'].includes(kind) && amount <= 0) {
      out.push({ rowNumber, date, kind, problem: '這個種類的金額必須大於 0' })
      continue
    }
    const note = col.note !== undefined ? String(row[col.note] ?? '').trim() : ''

    if (kind === 'transfer') {
      const fromName = col.from !== undefined ? row[col.from] : col.store !== undefined ? row[col.store] : null
      const toName = col.to !== undefined ? row[col.to] : null
      const fromStore = findStoreByName(stores, fromName)
      const toStore = findStoreByName(stores, toName)
      if (!fromStore || !toStore) {
        out.push({ rowNumber, date, kind, problem: `找不到分店：From「${fromName ?? ''}」/ To「${toName ?? ''}」` })
        continue
      }
      if (amount <= 0) {
        out.push({ rowNumber, date, kind, problem: '分店transfer 金額必須大於 0' })
        continue
      }
      const modeCell = col.mode !== undefined ? norm(row[col.mode]) : ''
      const mode = ['借貸償還', '借貸', 'loan_repay', 'loan repay'].includes(modeCell) ? 'loan_repay' : 'normal'
      out.push({ rowNumber, date, kind, amount, note, fromStoreId: fromStore.id, toStoreId: toStore.id, mode })
      continue
    }

    const storeNameCell = col.store !== undefined ? row[col.store] : null
    const store = storeNameCell ? findStoreByName(stores, storeNameCell) : stores.find((s) => s.id === defaultStoreId)
    if (!store) {
      out.push({ rowNumber, date, kind, problem: `找不到分店：「${storeNameCell ?? ''}」` })
      continue
    }

    if (kind === 'ruju') {
      const target = col.target !== undefined ? parseRujuTargetCell(row[col.target]) : null
      if (!target) {
        out.push({ rowNumber, date, kind, problem: '看不懂入金對象（需要 Jeff bank / Mao 保險箱 / 其他）' })
        continue
      }
      out.push({ rowNumber, date, kind, amount, note, storeId: store.id, rujuTarget: target })
      continue
    }

    const description = col.desc !== undefined ? String(row[col.desc] ?? '').trim() : ''
    out.push({ rowNumber, date, kind, amount, description, note, storeId: store.id })
  }
  return { rows: out, mapped, ignored }
}

// Marks each valid ledger row as a duplicate when an existing bk_cash_entries
// row already covers it (same store + date + kind + amount) — Point 5's
// "系統已有資料時，匯入的那筆跳過" rule. `existing` = bkData.listEntries() rows
// for the date range the file covers (storeId omitted, so it spans every
// store — a 分店transfer's two legs are in different stores).
export function markLedgerDuplicates(rows, existing) {
  const seen = new Set()
  for (const e of existing) {
    const kind = e.kind === 'ucost' && e.transfer_group_id ? 'transfer' : e.kind
    seen.add(`${e.store_id}|${e.entry_date}|${kind}|${Number(e.amount)}`)
  }
  return rows.map((r) => {
    if (r.problem) return r
    const key = r.kind === 'transfer' ? `${r.fromStoreId}|${r.date}|transfer|${r.amount}` : `${r.storeId}|${r.date}|${r.kind}|${r.amount}`
    return { ...r, duplicate: seen.has(key) }
  })
}

// 收成: manual 入金/Cost entries (bk_dividend_entries) and payouts
// (bk_payouts). Same flat-candidate-list shape as the ledger parser above.
const DIVIDEND_KIND_ALIASES = [
  ['income', ['income', '入金', 'ruju']],
  ['cost', ['cost']],
  ['payout', ['payout', '收成', '收成紀錄']],
]
function parseDividendKindCell(v) {
  const n = norm(v)
  for (const [kind, aliases] of DIVIDEND_KIND_ALIASES) if (aliases.includes(n)) return kind
  return null
}
// A cost says where it is paid from: Bank (Jeff B) / Cash (Mao保) / 其他.
function parseCostMethodCell(v) {
  const n = norm(v)
  if (['其他', 'other'].includes(n)) return 'other'
  if (['金庫外', 'outside'].includes(n)) return 'outside'
  return parseMethodCell(v)
}
function parseMethodCell(v) {
  const n = norm(v)
  if (['bank', '銀行'].includes(n)) return 'bank'
  if (['cash', '現金'].includes(n)) return 'cash'
  return null
}
function findPartyByName(parties, storeId, name) {
  if (name === null || name === undefined || String(name).trim() === '') return null
  const n = norm(name)
  return parties.find((p) => p.store_id === storeId && norm(p.name) === n) ?? null
}

const DIVIDEND_HEADER_MAP = [
  ['date', ['date', '日期', '日']],
  ['store', ['store', '分店']],
  ['kind', ['type', 'kind', '種類', '類型']],
  ['party', ['party', 'party名稱']],
  ['method', ['method', '方式']],
  ['amount', ['amount', '金額']],
  ['note', ['note', '附註', '備註']],
]

export function parseDividendRows(rows, { stores, parties }) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { error: '找不到標題列：檔案需要有「Date」或「日期」欄。', rows: [], mapped: [], ignored: [] }
  const headers = rows[headerIdx]
  const col = {}
  const mapped = []
  const ignored = []
  headers.forEach((h, i) => {
    if (h === null || h === undefined || String(h).trim() === '') return
    const label = String(h).replace(/\s+/g, ' ').trim()
    const n = normHeader(h)
    const hit = DIVIDEND_HEADER_MAP.find(([key, aliases]) => col[key] === undefined && aliases.includes(n))
    if (hit) {
      col[hit[0]] = i
      mapped.push({ header: label, target: hit[0] })
    } else ignored.push({ header: label, reason: '沒有對應的欄位' })
  })
  if (col.date === undefined) return { error: '找不到「Date」或「日期」欄。', rows: [], mapped, ignored }
  if (col.store === undefined) return { error: '找不到「Store」或「分店」欄。', rows: [], mapped, ignored }
  if (col.kind === undefined) return { error: '找不到「Type」或「種類」欄。', rows: [], mapped, ignored }
  if (col.amount === undefined) return { error: '找不到「Amount」或「金額」欄。', rows: [], mapped, ignored }

  const out = []
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const hasContent = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')
    if (!hasContent) continue
    const rowNumber = r + 1
    const date = parseDateCell(row[col.date], 0, 0)
    if (!date) {
      out.push({ rowNumber, problem: '日期看不懂（需要完整日期，例如 2026-10-05）' })
      continue
    }
    const store = findStoreByName(stores, row[col.store])
    if (!store) {
      out.push({ rowNumber, date, problem: `找不到分店：「${row[col.store] ?? ''}」` })
      continue
    }
    const kind = parseDividendKindCell(row[col.kind])
    if (!kind) {
      out.push({ rowNumber, date, problem: `看不懂的種類：「${row[col.kind] ?? ''}」（需要 income / cost / payout）` })
      continue
    }
    const amtRes = cellNumber(row[col.amount])
    if (amtRes.bad || amtRes.value === undefined || amtRes.value <= 0) {
      out.push({ rowNumber, date, kind, problem: '金額必須是大於 0 的數字' })
      continue
    }
    const amount = amtRes.value
    const note = col.note !== undefined ? String(row[col.note] ?? '').trim() : ''

    if (kind === 'payout') {
      const party = col.party !== undefined ? findPartyByName(parties, store.id, row[col.party]) : null
      if (!party) {
        out.push({ rowNumber, date, kind, problem: `找不到這個分店的 party：「${col.party !== undefined ? row[col.party] ?? '' : ''}」` })
        continue
      }
      const method = col.method !== undefined ? parseMethodCell(row[col.method]) : null
      if (!method) {
        out.push({ rowNumber, date, kind, problem: '看不懂方式（需要 Bank / Cash）' })
        continue
      }
      out.push({ rowNumber, date, kind, amount, note, storeId: store.id, partyId: party.id, method })
      continue
    }
    if (kind === 'cost') {
      const method = col.method !== undefined ? parseCostMethodCell(row[col.method]) : null
      if (!method) {
        out.push({ rowNumber, date, kind, problem: 'cost 需要「方式」欄（Bank / Cash / 其他 / 金庫外）' })
        continue
      }
      out.push({ rowNumber, date, kind, amount, note, storeId: store.id, method })
      continue
    }
    // income -> bk_dividend_entries
    out.push({ rowNumber, date, kind, amount, note, storeId: store.id })
  }
  return { rows: out, mapped, ignored }
}

// `existingEntries` = loadDividendData().manual (bk_dividend_entries rows),
// `existingPayouts` = .payouts (bk_payouts rows).
export function markDividendDuplicates(rows, existingEntries, existingPayouts) {
  const entryKeys = new Set(existingEntries.map((e) => `${e.store_id}|${e.entry_date}|${e.kind}|${Number(e.amount)}`))
  const payoutKeys = new Set(existingPayouts.map((p) => `${p.store_id}|${p.entry_date}|${p.party_id}|${p.method}|${Number(p.amount)}`))
  return rows.map((r) => {
    if (r.problem) return r
    const duplicate =
      r.kind === 'payout'
        ? payoutKeys.has(`${r.storeId}|${r.date}|${r.partyId}|${r.method}|${r.amount}`)
        : entryKeys.has(`${r.storeId}|${r.date}|${r.kind}|${r.amount}`)
    return { ...r, duplicate }
  })
}

// 積欠 > Jeff: manual 薪水/預付/預拿 rows (bk_owed_jeff_entries). Not scoped to
// any store or month.
const JEFF_OWED_KIND_ALIASES = [
  ['salary', ['薪水', 'salary']],
  ['advance_pay', ['預付', 'advance_pay', 'advance pay']],
  ['advance_draw', ['預拿', 'advance_draw', 'advance draw']],
]
function parseJeffOwedKindCell(v) {
  const n = norm(v)
  for (const [kind, aliases] of JEFF_OWED_KIND_ALIASES) if (aliases.includes(n)) return kind
  return null
}
const JEFF_OWED_HEADER_MAP = [
  ['date', ['date', '日期', '日']],
  ['kind', ['type', 'kind', '種類', '類型']],
  ['desc', ['description', 'desc', '說明', '敘述']],
  ['amount', ['amount', '金額']],
  ['note', ['note', '附註', '備註']],
]

export function parseJeffOwedRows(rows) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { error: '找不到標題列：檔案需要有「Date」或「日期」欄。', rows: [], mapped: [], ignored: [] }
  const headers = rows[headerIdx]
  const col = {}
  const mapped = []
  const ignored = []
  headers.forEach((h, i) => {
    if (h === null || h === undefined || String(h).trim() === '') return
    const label = String(h).replace(/\s+/g, ' ').trim()
    const n = normHeader(h)
    const hit = JEFF_OWED_HEADER_MAP.find(([key, aliases]) => col[key] === undefined && aliases.includes(n))
    if (hit) {
      col[hit[0]] = i
      mapped.push({ header: label, target: hit[0] })
    } else ignored.push({ header: label, reason: '沒有對應的欄位' })
  })
  if (col.date === undefined) return { error: '找不到「Date」或「日期」欄。', rows: [], mapped, ignored }
  if (col.kind === undefined) return { error: '找不到「Type」或「種類」欄。', rows: [], mapped, ignored }
  if (col.amount === undefined) return { error: '找不到「Amount」或「金額」欄。', rows: [], mapped, ignored }

  const out = []
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const hasContent = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')
    if (!hasContent) continue
    const rowNumber = r + 1
    const date = parseDateCell(row[col.date], 0, 0)
    if (!date) {
      out.push({ rowNumber, problem: '日期看不懂（需要完整日期，例如 2026-10-05）' })
      continue
    }
    const kind = parseJeffOwedKindCell(row[col.kind])
    if (!kind) {
      out.push({ rowNumber, date, problem: `看不懂的種類：「${row[col.kind] ?? ''}」（需要 薪水 / 預付 / 預拿）` })
      continue
    }
    const amtRes = cellNumber(row[col.amount])
    if (amtRes.bad || amtRes.value === undefined || amtRes.value <= 0) {
      out.push({ rowNumber, date, kind, problem: '金額必須是大於 0 的數字' })
      continue
    }
    const description = col.desc !== undefined ? String(row[col.desc] ?? '').trim() : ''
    const note = col.note !== undefined ? String(row[col.note] ?? '').trim() : ''
    out.push({ rowNumber, date, kind, amount: amtRes.value, description, note })
  }
  return { rows: out, mapped, ignored }
}

// `existing` = bkData.loadJeffOwedEntries() rows.
export function markJeffOwedDuplicates(rows, existing) {
  const seen = new Set(existing.map((e) => `${e.kind}|${e.entry_date}|${Number(e.amount)}`))
  return rows.map((r) => (r.problem ? r : { ...r, duplicate: seen.has(`${r.kind}|${r.date}|${r.amount}`) }))
}

// 積欠 > Emma: historical bonus claims (bk_owed_emma_claims). A claim normally
// bundles specific U帳 入金 rows, but a backfilled historical claim has no
// such rows to point at — it's imported as a claim with an empty `rows: []`
// (the submitted date, total amount and note are all that's known about it).
const EMMA_CLAIM_HEADER_MAP = [
  ['date', ['date', '日期', '日', 'submitted', '提交日期']],
  ['amount', ['amount', '金額', 'bonus', '收成金額']],
  ['note', ['note', '附註', '備註']],
]

export function parseEmmaClaimRows(rows) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { error: '找不到標題列：檔案需要有「Date」或「日期」欄。', rows: [], mapped: [], ignored: [] }
  const headers = rows[headerIdx]
  const col = {}
  const mapped = []
  const ignored = []
  headers.forEach((h, i) => {
    if (h === null || h === undefined || String(h).trim() === '') return
    const label = String(h).replace(/\s+/g, ' ').trim()
    const n = normHeader(h)
    const hit = EMMA_CLAIM_HEADER_MAP.find(([key, aliases]) => col[key] === undefined && aliases.includes(n))
    if (hit) {
      col[hit[0]] = i
      mapped.push({ header: label, target: hit[0] })
    } else ignored.push({ header: label, reason: '沒有對應的欄位' })
  })
  if (col.date === undefined) return { error: '找不到「Date」或「日期」欄。', rows: [], mapped, ignored }
  if (col.amount === undefined) return { error: '找不到「Amount」或「金額」欄。', rows: [], mapped, ignored }

  const out = []
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const hasContent = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')
    if (!hasContent) continue
    const rowNumber = r + 1
    const date = parseDateCell(row[col.date], 0, 0)
    if (!date) {
      out.push({ rowNumber, problem: '日期看不懂（需要完整日期，例如 2026-10-05）' })
      continue
    }
    const amtRes = cellNumber(row[col.amount])
    if (amtRes.bad || amtRes.value === undefined || amtRes.value <= 0) {
      out.push({ rowNumber, date, problem: '金額必須是大於 0 的數字' })
      continue
    }
    const note = col.note !== undefined ? String(row[col.note] ?? '').trim() : ''
    out.push({ rowNumber, date, amount: amtRes.value, note })
  }
  return { rows: out, mapped, ignored }
}

// `existing` = bkData.loadEmmaClaims() rows.
export function markEmmaClaimDuplicates(rows, existing) {
  const seen = new Set(existing.map((c) => `${c.submitted_at}|${Number(c.total_amount)}`))
  return rows.map((r) => (r.problem ? r : { ...r, duplicate: seen.has(`${r.date}|${r.amount}`) }))
}

// ---------------------------------------------------------------------------
// Image import (the reading of the picture is a later phase). When it lands,
// the labels it finds go through here first: the report's "Eftpos" and
// "Eftpos offline" lines are ONE payment type on the sheet, POS eftpos, so
// their amounts are added together. `lines` = [{ label, amount }];
// returns the same shape with those two merged into a single 'POS eftpos' line
// (placed where the first of them was). Other lines pass through unchanged.
// ---------------------------------------------------------------------------
const EFTPOS_LABELS = new Set(['eftpos', 'eftpos offline'])

export function mergeEftposLines(lines) {
  const out = []
  let merged = null
  for (const line of lines) {
    if (EFTPOS_LABELS.has(norm(line.label))) {
      if (!merged) {
        merged = { label: 'POS eftpos', amount: 0 }
        out.push(merged)
      }
      merged.amount = Math.round((merged.amount + (toNum(line.amount) ?? 0) + Number.EPSILON) * 100) / 100
    } else out.push(line)
  }
  return out
}
