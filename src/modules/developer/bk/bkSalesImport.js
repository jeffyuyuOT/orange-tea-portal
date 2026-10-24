// Excel import for the 營業 tab. Pure parsing, like parseSfRows in bkImport.js.
// Columns are matched by HEADER NAME, so the file the 營業 tab exports
// (日期 | 總營業額 | 總杯數 | P杯數 | POS | CV | Self O | SO杯數) and the 系統設置
// template both import straight back:
//   日期 / Date     which day
//   P杯數 / POS / CV / Self O / SO杯數     -> that field
//   總營業額 / 總杯數 / Total               ignored (calculated)
// A store linked to SF has its POS read from SF's O.POST, so a POS column is
// ignored for it.
import { cellNumber, findHeaderRow, parseDateCell } from './bkImport'

const key = (s) => String(s ?? '').toLowerCase().replace(/[\s._\-()（）]/g, '')

const FIELD_BY_HEADER = {
  p杯數: ['p_cups', 'P杯數'],
  p杯: ['p_cups', 'P杯數'],
  pcups: ['p_cups', 'P杯數'],
  pcup: ['p_cups', 'P杯數'],
  pos: ['pos', 'POS'],
  cv: ['cv', 'CV'],
  selfo: ['self_o', 'Self O'],
  selforder: ['self_o', 'Self O'],
  selforderkiosk: ['self_o', 'Self O'],
  so杯數: ['so_cups', 'SO杯數'],
  so杯: ['so_cups', 'SO杯數'],
  socups: ['so_cups', 'SO杯數'],
  socup: ['so_cups', 'SO杯數'],
}
const COMPUTED = new Set(['總營業額', '營業額', '總杯數', '杯數', 'total', 'sumvstotal'])
const DATE_KEYS = new Set(['date', '日期', '日'])
const SUMMARY = /^(total|sum|合計|總計|總和|平均|average|avg)/i

export function parseBizRows(rows, { year, month, linked }) {
  const empty = { entries: {}, mapped: [], ignored: [], otherMonths: [], unreadable: 0, badCells: 0, notes: [], dayCount: 0, cellCount: 0 }
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { ...empty, error: '找不到標題列：檔案的表頭需要有「日期」或「Date」欄。' }
  const headers = rows[headerIdx]

  const targets = []
  const mapped = []
  const ignored = []
  let dateCol = -1
  headers.forEach((h, i) => {
    if (h === null || h === undefined || String(h).trim() === '') return
    const label = String(h).replace(/\s+/g, ' ').trim()
    const k = key(h)
    if (DATE_KEYS.has(k) && dateCol < 0) dateCol = i
    else if (COMPUTED.has(k)) ignored.push({ header: label, reason: '由系統計算，不匯入' })
    else if (FIELD_BY_HEADER[k]) {
      const [field, name] = FIELD_BY_HEADER[k]
      if (field === 'pos' && linked) ignored.push({ header: label, reason: '這間分店連結SF，POS 讀SF的 O.POST，不匯入' })
      else {
        targets[i] = field
        mapped.push({ header: label, target: name })
      }
    } else ignored.push({ header: label, reason: '看不懂的欄位' })
  })

  const entries = {}
  const otherMonths = new Set()
  const ym = `${year}-${String(month).padStart(2, '0')}`
  let unreadable = 0
  let badCells = 0
  let cellCount = 0
  let duplicateDays = 0
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    if (!row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) continue
    const dateCell = row[dateCol]
    if (typeof dateCell === 'string' && SUMMARY.test(dateCell.trim())) continue
    const date = parseDateCell(dateCell, year, month)
    if (!date) {
      unreadable++
      continue
    }
    if (date.slice(0, 7) !== ym) {
      otherMonths.add(date.slice(0, 7))
      continue
    }
    const entry = entries[date] ?? {}
    if (entries[date]) duplicateDays++
    let any = false
    targets.forEach((field, i) => {
      if (!field) return
      const res = cellNumber(row[i])
      if (res.bad) badCells++
      if (res.value === undefined) return
      entry[field] = res.value
      any = true
      cellCount++
    })
    if (any) entries[date] = entry
  }
  const notes = duplicateDays ? [`有 ${duplicateDays} 天在檔案裡出現不只一次，以後面那一列為準。`] : []
  return { entries, mapped, ignored, otherMonths: [...otherMonths].sort(), unreadable, badCells, notes, dayCount: Object.keys(entries).length, cellCount }
}

// Drops every field the month already has a number for (`days` = bizDaysFromRows
// strings), so 套用 only fills gaps. Returns { entries, skipped }.
export function filterKeepExistingBiz(entries, days) {
  const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== ''
  const out = {}
  let skipped = 0
  for (const [date, entry] of Object.entries(entries)) {
    const cur = days[date]
    const next = {}
    for (const [field, v] of Object.entries(entry)) {
      if (cur && hasValue(cur[field])) skipped++
      else next[field] = v
    }
    if (Object.keys(next).length) out[date] = next
  }
  return { entries: out, skipped }
}
