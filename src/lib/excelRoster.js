import * as XLSX from 'xlsx'
import { format, parseISO } from 'date-fns'

// Manage Roster's spreadsheet is a "grid" layout that mirrors how the
// manager already builds rosters in Excel: one Name column, then an S/E
// (start/end) column pair per weekday, a Break sub-row under each staff
// member's shift row, and computed Total hr / WKD hr columns at the end.
// This file is the one place that knows that layout, in both directions:
// generating a blank template, parsing an uploaded/pasted-together
// workbook back into flat shift records, and exporting the current grid
// (single store, or one sheet per store for the admin multi-store export).

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Column layout (0-indexed): Name, then 7×(S,E), then Total hr, then WKD hr.
const NAME_COL = 0
const FIRST_DAY_COL = 1
const TOTAL_COL = FIRST_DAY_COL + 7 * 2 // 15
const WKD_COL = TOTAL_COL + 1 // 16
const LAST_COL = WKD_COL

function round2(n) {
  return Math.round(n * 100) / 100
}

// ---- decimal-hour ("11", "22.5") <-> "HH:MM:SS" (Postgres `time`) --------
// The manager's own roster writes shift times as plain decimal hours
// (22.5 = 10:30pm) rather than clock strings, so the whole grid — on
// screen and in the spreadsheet — speaks decimal hours; these two
// functions are the only place that talk to the "HH:MM:SS" the database
// column actually stores.
export function decimalToTime(dec) {
  if (dec === '' || dec === null || dec === undefined) return null
  const n = Number(dec)
  if (Number.isNaN(n)) return null
  const h = Math.floor(n)
  const m = Math.round((n - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

export function timeToDecimal(time) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h)) return ''
  return round2(h + (m || 0) / 60)
}

// Accepts "22", "22.5", "22:30", or an Excel time-of-day serial (SheetJS
// hands back a fraction like 0.9375 for a cell formatted as a time) and
// always returns decimal hours, or '' for blank/unreadable — used when
// reading an uploaded workbook, since a manager might paste times either way.
function parseHourCell(value) {
  if (value === '' || value === null || value === undefined) return ''
  if (typeof value === 'number') {
    return value > 0 && value < 1 ? round2(value * 24) : round2(value)
  }
  const str = String(value).trim()
  if (!str) return ''
  if (str.includes(':')) {
    const [h, m] = str.split(':').map(Number)
    if (Number.isNaN(h)) return ''
    return round2(h + (m || 0) / 60)
  }
  const n = Number(str)
  return Number.isNaN(n) ? '' : n
}

// A shift's paid hours for one day: end − start − break, or 0 if the shift
// isn't fully filled in. `breakHours` is in HALF-HOUR units (1 = 30 min,
// 2 = 1 hr) — the same units the manager already writes in the Excel
// roster's Break row — so it's halved here to get actual hours.
export function dayHours(entry) {
  if (!entry) return 0
  const start = Number(entry.startTime)
  const end = Number(entry.endTime)
  if (entry.startTime === '' || entry.endTime === '' || Number.isNaN(start) || Number.isNaN(end)) return 0
  const brk = (Number(entry.breakHours) || 0) / 2
  return Math.max(0, end - start - brk)
}

// ---- shared grid-building helpers ---------------------------------------
function buildHeaderRows(weekDates) {
  const row1 = Array.from({ length: LAST_COL + 1 }, () => '')
  const row2 = Array.from({ length: LAST_COL + 1 }, () => '')
  row1[NAME_COL] = 'Name'
  weekDates.forEach((d, i) => {
    const c = FIRST_DAY_COL + i * 2
    row1[c] = `${DAY_LABELS[i]} ${format(parseISO(d), 'd-MMM')}`
    row2[c] = 'S'
    row2[c + 1] = 'E'
  })
  row1[TOTAL_COL] = 'Total hr'
  row1[WKD_COL] = 'WKD hr'
  return [row1, row2]
}

function headerMerges() {
  const merges = [
    { s: { r: 0, c: NAME_COL }, e: { r: 1, c: NAME_COL } },
    { s: { r: 0, c: TOTAL_COL }, e: { r: 1, c: TOTAL_COL } },
    { s: { r: 0, c: WKD_COL }, e: { r: 1, c: WKD_COL } },
  ]
  for (let i = 0; i < 7; i++) {
    const c = FIRST_DAY_COL + i * 2
    merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 1 } })
  }
  return merges
}

function gridCols() {
  return [{ wch: 16 }, ...Array.from({ length: 14 }, () => ({ wch: 6 })), { wch: 9 }, { wch: 9 }]
}

function staffFullName(s) {
  return `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim()
}

// Builds the full row set (header + one Shift/Break row pair per person +
// a grand-total footer) for a store's week, from the flat `entries` array.
// `staff` should be every active staff member for the store (shown even
// with zero shifts, same as the manager's own template); any entry with no
// matching profile (an ad-hoc/casual name typed straight into the grid)
// gets its own row too.
function buildGridRows(staff, weekDates, entries) {
  const [row1, row2] = buildHeaderRows(weekDates)
  const rows = [row1, row2]

  const extraNames = Array.from(new Set(entries.filter((e) => !e.profileId && e.staffName).map((e) => e.staffName)))
  const people = [
    ...staff.map((s) => ({ id: s.id, name: staffFullName(s) })),
    ...extraNames.map((name) => ({ id: '', name })),
  ]

  let grandTotal = 0
  people.forEach(({ id, name }) => {
    const shiftRow = Array.from({ length: LAST_COL + 1 }, () => '')
    const breakRow = Array.from({ length: LAST_COL + 1 }, () => '')
    shiftRow[NAME_COL] = name
    breakRow[NAME_COL] = 'Break (½h units)'
    let total = 0
    let wkd = 0
    weekDates.forEach((date, i) => {
      const entry = entries.find((e) => (id ? e.profileId === id : e.staffName === name) && e.date === date)
      if (!entry) return
      const c = FIRST_DAY_COL + i * 2
      shiftRow[c] = entry.startTime === '' || entry.startTime == null ? '' : entry.startTime
      shiftRow[c + 1] = entry.endTime === '' || entry.endTime == null ? '' : entry.endTime
      breakRow[c] = entry.breakHours === '' || entry.breakHours == null ? '' : entry.breakHours
      const h = dayHours(entry)
      total += h
      if (i === 5 || i === 6) wkd += h
    })
    shiftRow[TOTAL_COL] = total ? round2(total) : ''
    shiftRow[WKD_COL] = wkd ? round2(wkd) : ''
    grandTotal += total
    rows.push(shiftRow, breakRow)
  })

  const totalRow = Array.from({ length: LAST_COL + 1 }, () => '')
  totalRow[NAME_COL] = 'Total'
  totalRow[TOTAL_COL] = round2(grandTotal)
  rows.push(totalRow)

  return rows
}

// ---- template download ---------------------------------------------------
// A blank grid, pre-filled with every active staff member's name, ready to
// type hours straight into (in Excel, offline) and upload back with
// parseRosterGrid.
export function downloadRosterTemplate(storeName, staff, weekDates, filename) {
  const [row1, row2] = buildHeaderRows(weekDates)
  const rows = [row1, row2]
  staff.forEach((s) => {
    const shiftRow = Array.from({ length: LAST_COL + 1 }, () => '')
    const breakRow = Array.from({ length: LAST_COL + 1 }, () => '')
    shiftRow[NAME_COL] = staffFullName(s)
    breakRow[NAME_COL] = 'Break (½h units)'
    rows.push(shiftRow, breakRow)
  })
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = headerMerges()
  sheet['!cols'] = gridCols()
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, (storeName || 'Roster').slice(0, 31))
  XLSX.writeFile(wb, filename || `roster-template-${weekDates[0] || ''}.xlsx`)
}

// ---- upload / parse -------------------------------------------------------
// Parses a workbook built in this same grid shape back into flat shift
// records: { profileId, staffName, date, startTime, endTime, breakHours }.
// Matches each row's Name cell against `staff` by full name (case/space
// insensitive); an unmatched name is kept with profileId '' so it still
// shows up as its own row in the grid (e.g. a casual not yet in Staff
// Information) rather than being silently dropped.
export function parseRosterGrid(file, staff, weekDates) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
        const byName = new Map(staff.map((s) => [staffFullName(s).toLowerCase(), s]))

        const entries = []
        let i = 2 // skip the two header rows
        while (i < aoa.length) {
          const row = aoa[i] ?? []
          const name = String(row[NAME_COL] ?? '').trim()
          if (!name || name.toLowerCase() === 'total') {
            i += 1
            continue
          }
          let breakRow = null
          const next = aoa[i + 1]
          if (next && String(next[NAME_COL] ?? '').trim().toLowerCase().startsWith('break')) {
            breakRow = next
            i += 2
          } else {
            i += 1
          }
          const match = byName.get(name.toLowerCase())
          weekDates.forEach((date, di) => {
            const c = FIRST_DAY_COL + di * 2
            const startTime = parseHourCell(row[c])
            const endTime = parseHourCell(row[c + 1])
            const breakHours = breakRow ? parseHourCell(breakRow[c]) : ''
            if (startTime === '' && endTime === '' && breakHours === '') return
            entries.push({
              profileId: match?.id ?? '',
              staffName: match ? staffFullName(match) : name,
              date,
              startTime,
              endTime,
              breakHours,
              notes: '',
            })
          })
        }
        resolve(entries)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ---- export ---------------------------------------------------------------
// Exports the current (already-computed) grid — real numbers, not
// formulas, since the app has already done the arithmetic.
export function exportRosterGrid(storeName, staff, weekDates, entries, filename) {
  const rows = buildGridRows(staff, weekDates, entries)
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = headerMerges()
  sheet['!cols'] = gridCols()
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, (storeName || 'Roster').slice(0, 31))
  XLSX.writeFile(wb, filename)
}

// One sheet per store (admin multi-store export). Each entry in
// `storeSheets` is { storeName, staff, weekDates, entries }.
export function exportMultiStoreWorkbook(storeSheets, filename) {
  const wb = XLSX.utils.book_new()
  storeSheets.forEach(({ storeName, staff, weekDates, entries }) => {
    const rows = buildGridRows(staff, weekDates, entries)
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!merges'] = headerMerges()
    sheet['!cols'] = gridCols()
    XLSX.utils.book_append_sheet(wb, sheet, (storeName || 'Store').slice(0, 31))
  })
  XLSX.writeFile(wb, filename)
}
