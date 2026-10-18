// 填入會計表: writes the month's Sales figure numbers into the accountant's own
// Excel workbook (the one with the per-store sheets and the "… MYOB" sheets),
// touching only the typed-in cells. Every formula, format and MYOB sheet stays as it
// is, so the file imports into MYOB exactly like the hand-filled one.
//
// How the sheet is read: each store sheet has its column titles in row 3 and one row
// per day from row 4 (the 1st). A title is matched with the store's payment type by
// name (ignoring case / spaces). A column whose row-4 cell is a formula
// (TOTAL EFTPOS, Panda = Easi + Panda, Total, Check …) is never written.
import { monthLabel } from '../bkUtils'

const HEADER_ROW = 3
const FIRST_DAY_ROW = 4
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
// Titles in the workbook that are written differently from the payment type name.
const ALIASES = { postotal: 'postotal', eftpos: 'poseftpos' }
// Columns that are never payment figures.
const NEVER = new Set(['', 'month', 'date', 'total', 'sumvstotalcheck'])
// No longer used by the stores: always 0.
const ZERO = new Set(['easi'])

const isFormula = (cell) => {
  const v = cell.value
  return !!v && typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined)
}
const cellText = (cell) => {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return String(v.result ?? v.text ?? v.richText?.map((r) => r.text).join('') ?? '')
  return String(v)
}

// "POS Sunnybank" -> "sunnybank"; the store sheet is found by that name (or the sheet's own name).
function sheetStoreKey(ws) {
  const e1 = norm(cellText(ws.getCell('E1')).replace(/^pos\s*/i, ''))
  return e1 || norm(ws.name)
}

// The date in A4 must be the 1st of the chosen month — otherwise this is the wrong month's file.
function sheetMonthOk(ws, year, month) {
  const a4 = ws.getCell(`A${FIRST_DAY_ROW}`).value
  const d = a4 instanceof Date ? a4 : a4 && a4.result instanceof Date ? a4.result : null
  if (!d) return true // linked sheets (=Sunnypark!A4): checked on the first sheet
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month
}

// months: [{ store, columns, rows, dates }] from loadStoreMonthForSubmit.
export function fillMyobWorkbook(wb, { year, month, months }) {
  const report = []
  const problems = []
  // Drop every formula's old cached result: the numbers change with this fill, and exceljs
  // also reads a text result like "02/10/26" as a broken date and would write NaN back.
  // Excel recalculates all formulas when the file opens.
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value
        if (v && typeof v === 'object' && v.result !== undefined && (v.formula !== undefined || v.sharedFormula !== undefined)) {
          const { result: _drop, ...rest } = v
          cell.value = rest
        }
      })
    )
  }
  const byKey = new Map(months.map((m) => [norm(m.store.name), m]))
  const used = new Set()

  for (const ws of wb.worksheets) {
    if (/myob/i.test(ws.name)) continue
    const m = byKey.get(sheetStoreKey(ws)) ?? byKey.get(norm(ws.name))
    if (!m) {
      problems.push(`工作表「${ws.name}」找不到對應的分店，沒有填。`)
      continue
    }
    if (!sheetMonthOk(ws, year, month)) {
      problems.push(`工作表「${ws.name}」的日期不是 ${monthLabel(year, month)}，沒有填。請確認選的月份和 Excel 一致。`)
      continue
    }
    used.add(m.store.id)

    // value getters by normalised name
    const getters = new Map()
    for (const c of m.columns) {
      getters.set(norm(c.name), (i) => m.rows[i].mains[c.id])
      for (const s of c.subs) getters.set(norm(s.name), (i) => m.rows[i].subAmounts[s.id])
    }

    const filled = []
    const skipped = []
    ws.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (hc, col) => {
      const title = cellText(hc).trim()
      const key = norm(title)
      if (NEVER.has(key)) return
      if (isFormula(ws.getCell(FIRST_DAY_ROW, col))) return
      const zero = ZERO.has(key)
      const get = getters.get(ALIASES[key] ?? key)
      if (!get && !zero) {
        skipped.push(title)
        return
      }
      m.dates.forEach((_, i) => {
        const cell = ws.getCell(FIRST_DAY_ROW + i, col)
        if (isFormula(cell)) return
        let v = zero ? (m.rows[i].oCa !== null || m.rows[i].oPost !== null ? 0 : null) : get(i)
        cell.value = v === undefined || v === null ? null : Math.round((v + Number.EPSILON) * 100) / 100
      })
      filled.push(title)
    })
    // the days beyond this month's length stay as they are (blank)
    report.push({ sheet: ws.name, store: m.store.name, filled, skipped, notSubmitted: m.sfMonth?.status !== 'submitted' })
  }

  for (const m of months) {
    if (!used.has(m.store.id)) problems.push(`分店「${m.store.name}」在 Excel 裡沒有對應的工作表，沒有填。`)
  }
  // Excel recalculates every formula when the file is opened.
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true }
  return { report, problems }
}

export async function fillMyobFile(arrayBuffer, args) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const result = fillMyobWorkbook(wb, args)
  return { ...result, buffer: await wb.xlsx.writeBuffer() }
}
