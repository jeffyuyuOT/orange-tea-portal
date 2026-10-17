// Bulk history import for the 營業 tab — the old yearly workbooks (one tab per
// month named YYYYMM, every store side by side in blocks of columns).  Pure
// parsing, nothing is written here.
//
// A tab looks like:
//   row 1  store name over the first column of each block (Sunnypark, Toowong …)
//          — absent in the oldest tabs, which hold one store only
//   row 2  日期 | 營業額 | 杯數 | 杯數 P | POS | CV | Self O | 杯自   (per block)
//   rows   one per day
// Columns that vary by year are handled by header name:
//   POS / CV / Self O (Self order)   -> pos / cv / self_o
//   杯數 P  -> p_cups,  杯自 -> so_cups
//   營業額 / 杯數 are the sheet's own totals (formulas in newer tabs).
// Older tabs only have those two totals (and from 2020-12 POS + Self order with a
// single 杯數 total).  Because the page calculates 總營業額 = POS + Self O + CV×4
// and 總杯數 = P杯數 + SO杯數, such rows are stored so the same totals come out:
//   - no POS/Self O/CV at all  -> 營業額 goes into POS
//   - no 杯數 P / 杯自 split   -> 杯數 goes into P杯數
import { cellNumber, parseDateCell } from './bkImport'

const k = (s) => String(s ?? '').toLowerCase().replace(/[\s._\-()（）]/g, '')

const ROLE_BY_KEY = {
  日期: 'date', date: 'date', 日: 'date',
  營業額: 'total', 總營業額: 'total',
  杯數: 'cups', 總杯數: 'cups',
  杯數p: 'p_cups', p杯數: 'p_cups', p杯: 'p_cups', pcups: 'p_cups',
  杯自: 'so_cups', so杯數: 'so_cups', so杯: 'so_cups', socups: 'so_cups',
  pos: 'pos',
  cv: 'cv',
  selfo: 'self_o', selforder: 'self_o', selforderkiosk: 'self_o',
}
const SUMMARY = /^(total|sum|合計|總計|總和|平均|average|avg)/i
export const SHEET_YM = /^(\d{4})(\d{2})$/
export const LEGACY_STORE = 'Sunnypark' // tabs without a store name are the original single store

export function isMonthSheet(name) {
  const m = SHEET_YM.exec(String(name).trim())
  return !!m && Number(m[1]) >= 2000 && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

function roleOf(h) {
  if (h === null || h === undefined || String(h).trim() === '') return null
  return ROLE_BY_KEY[k(h)] ?? null
}

// -> { stores: { [name]: { entries, months:[ym], legacyDays } }, skippedSheets:[], unreadable, badCells, otherMonth }
export function parseBizHistorySheets(sheets) {
  const stores = {}
  const skippedSheets = []
  let unreadable = 0
  let badCells = 0
  let otherMonth = 0
  let mismatch = 0

  for (const sheet of sheets) {
    const m = SHEET_YM.exec(String(sheet.name).trim())
    if (!m || !isMonthSheet(sheet.name)) {
      skippedSheets.push(sheet.name)
      continue
    }
    const year = Number(m[1])
    const month = Number(m[2])
    const ym = `${m[1]}-${m[2]}`
    const rows = sheet.rows
    // header row: the first of the top 4 rows that has a 日期 cell
    let hi = -1
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      if ((rows[i] ?? []).some((c) => roleOf(c) === 'date')) {
        hi = i
        break
      }
    }
    // 201711-style tab with no header at all: date, 營業額 [, 杯數]
    const headers = hi >= 0 ? rows[hi] ?? [] : ['日期', '營業額', '杯數']
    const dataStart = hi >= 0 ? hi + 1 : 0
    const nameRow = hi > 0 ? rows[hi - 1] ?? [] : []

    // blocks = every 日期 column up to the next one
    const dateCols = []
    headers.forEach((h, i) => roleOf(h) === 'date' && dateCols.push(i))
    dateCols.forEach((start, bi) => {
      const end = bi + 1 < dateCols.length ? dateCols[bi + 1] : headers.length
      const cols = {}
      for (let c = start + 1; c < end; c++) {
        const role = roleOf(headers[c])
        if (role && cols[role] === undefined) cols[role] = c
      }
      let name = ''
      for (let c = start; c < end && !name; c++) {
        const v = nameRow[c]
        if (typeof v === 'string' && v.trim()) name = v.trim()
      }
      if (!name) name = LEGACY_STORE
      const hasParts = cols.pos !== undefined || cols.self_o !== undefined || cols.cv !== undefined
      const hasCupSplit = cols.p_cups !== undefined || cols.so_cups !== undefined
      const store = (stores[name] ??= { entries: {}, months: new Set(), legacyDays: 0, mismatchDays: 0 })

      for (let r = dataStart; r < rows.length; r++) {
        const row = rows[r] ?? []
        const dateCell = row[start]
        if (typeof dateCell === 'string' && SUMMARY.test(dateCell.trim())) continue
        if (dateCell === null || dateCell === undefined || dateCell === '') continue
        const date = parseDateCell(dateCell, year, month)
        if (!date) {
          unreadable++
          continue
        }
        if (date.slice(0, 7) !== ym) {
          otherMonth++
          continue
        }
        const num = (role) => {
          if (cols[role] === undefined) return undefined
          const res = cellNumber(row[cols[role]])
          if (res.bad) badCells++
          return res.value
        }
        const e = {}
        const set = (f, v) => v !== undefined && (e[f] = v)
        if (hasParts) {
          set('pos', num('pos'))
          set('self_o', num('self_o'))
          set('cv', num('cv'))
        } else {
          set('pos', num('total')) // totals only: 營業額 stands in for POS
          if (e.pos !== undefined) store.legacyDays++
        }
        if (hasCupSplit) {
          set('p_cups', num('p_cups'))
          set('so_cups', num('so_cups'))
        } else {
          set('p_cups', num('cups')) // one 杯數 total: stands in for P杯數
        }
        if (Object.keys(e).length === 0) continue
        // sheet's own 營業額 vs POS + Self O + CV×4 — only reported
        const tot = num('total')
        if (hasParts && tot !== undefined) {
          const calc = (e.pos ?? 0) + (e.self_o ?? 0) + (e.cv ?? 0) * 4
          if (Math.abs(calc - tot) > 0.5) store.mismatchDays++
        }
        store.entries[date] = e
        store.months.add(ym)
      }
    })
  }
  for (const s of Object.values(stores)) {
    s.months = [...s.months].sort()
    mismatch += s.mismatchDays
  }
  return { stores, skippedSheets, unreadable, badCells, otherMonth, mismatch }
}
