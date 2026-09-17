import * as XLSX from 'xlsx'

// Fixed roster import/export format: one row per shift.
// Columns: Staff Email | Date (YYYY-MM-DD) | Start Time (HH:MM) | End Time (HH:MM) | Notes
export const ROSTER_COLUMNS = ['Staff Email', 'Date', 'Start Time', 'End Time', 'Notes']

export function downloadRosterTemplate(staff, weekDates, filename = 'roster-template.xlsx') {
  const helperRows = staff.map((s) => [s.email, '', '', '', ''])
  const sheet = XLSX.utils.aoa_to_sheet([
    ROSTER_COLUMNS,
    ...helperRows,
  ])
  sheet['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 24 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Roster')
  const staffRef = XLSX.utils.aoa_to_sheet([
    ['This week’s dates for reference:'],
    ...weekDates.map((d) => [d]),
  ])
  XLSX.utils.book_append_sheet(wb, staffRef, 'Week Dates')
  XLSX.writeFile(wb, filename)
}

export function parseRosterFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        const parsed = rows
          .map((r) => ({
            staffEmail: String(r['Staff Email'] ?? '').trim(),
            date: normalizeDate(r['Date']),
            startTime: String(r['Start Time'] ?? '').trim(),
            endTime: String(r['End Time'] ?? '').trim(),
            notes: String(r['Notes'] ?? '').trim(),
          }))
          .filter((r) => r.staffEmail && r.date)
        resolve(parsed)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function normalizeDate(value) {
  if (!value) return ''
  if (typeof value === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(value)
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  return String(value).trim()
}

export function exportRosterWorkbook(entries, filename) {
  const rows = entries.map((e) => ({
    'Staff Email': e.staffEmail,
    Date: e.date,
    'Start Time': e.startTime,
    'End Time': e.endTime,
    Notes: e.notes,
  }))
  const sheet = XLSX.utils.json_to_sheet(rows, { header: ROSTER_COLUMNS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Roster')
  XLSX.writeFile(wb, filename)
}

// One sheet per store, sheet name = store name (Admin multi-store export).
export function exportMultiStoreWorkbook(storeSheets, filename) {
  const wb = XLSX.utils.book_new()
  storeSheets.forEach(({ storeName, entries }) => {
    const rows = entries.map((e) => ({
      'Staff Email': e.staffEmail,
      Date: e.date,
      'Start Time': e.startTime,
      'End Time': e.endTime,
      Notes: e.notes,
    }))
    const sheet = XLSX.utils.json_to_sheet(rows, { header: ROSTER_COLUMNS })
    XLSX.utils.book_append_sheet(wb, sheet, storeName.slice(0, 31))
  })
  XLSX.writeFile(wb, filename)
}
