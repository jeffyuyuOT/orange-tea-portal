// Excel exports for the BK 營業 tab: "Excel 匯出" (a date range, one tab per
// store) and "週匯出" (one Monday-to-Sunday week, every store side by side).
// exceljs is loaded on demand (via bkExcel) so it stays out of the main bundle.
import { download, newWorkbook } from './bkExcel'
import { loadSalesRange, loadSfPostRange } from './bkSalesData'
import { addDays, bizDayRow, bizTotals, datesBetween, isMonday } from './bkSalesUtils'
import { weekdayOf } from './bkUtils'

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFED7AA' } } // 日期 / 總營業額 / 總杯數
const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } } // P杯數 … SO杯數
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } }
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00'
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } }
const MEDIUM = { style: 'medium', color: { argb: 'FF000000' } }

const safeName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
const safeSheetName = (s) => String(s).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Store'

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// Turns the stored rows into, per store, one computed row per date. A store
// linked to SF takes POS from SF's O.POST (blank if SF has none that day).
export function assembleBiz(stores, dates, dayRows, postRows) {
  const days = new Map(dayRows.map((r) => [`${r.store_id}|${r.day}`, r]))
  const posts = new Map(postRows.map((r) => [`${r.sf_store_id}|${r.day}`, r.o_post]))
  return stores.map((store) => ({
    store,
    rows: dates.map((date) => ({
      date,
      ...bizDayRow(
        days.get(`${store.id}|${date}`),
        store.sf_store_id ? (posts.get(`${store.sf_store_id}|${date}`) ?? null) : undefined
      ),
    })),
  }))
}

async function collect(stores, from, to) {
  const dates = datesBetween(from, to)
  const [dayRows, postRows] = await Promise.all([
    loadSalesRange(
      stores.map((s) => s.id),
      from,
      to
    ),
    loadSfPostRange(stores.map((s) => s.sf_store_id).filter(Boolean), from, to),
  ])
  return assembleBiz(stores, dates, dayRows, postRows)
}

// ---------------------------------------------------------------------------
// Excel 匯出
// ---------------------------------------------------------------------------

const HEADERS = ['日期', '總營業額', '總杯數', 'P杯數', 'POS', 'CV', 'Self O', 'SO杯數']
const KEYS = ['total', 'cups', 'pCups', 'pos', 'cv', 'selfO', 'soCups']
const MONEY_KEYS = new Set(['total', 'pos', 'selfO'])

// Gridlines on every cell, with a heavier line between the first group
// (日期, 總營業額, 總杯數) and the manual-input group (P杯數 … SO杯數).
function gridRow(row) {
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.border = { top: THIN, bottom: THIN, left: col === 4 ? MEDIUM : THIN, right: col === 3 ? MEDIUM : THIN }
  })
}

// Builds the workbook (no download) so it can be tested.
export async function buildBizRangeWorkbook({ blocks, from, to }) {
  const wb = await newWorkbook()
  const used = new Set()
  for (const { store, rows } of blocks) {
    let name = safeSheetName(store.name)
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${safeSheetName(store.name).slice(0, 28)} ${n}`
    used.add(name.toLowerCase())
    const ws = wb.addWorksheet(name)
    ws.addRow([`${store.name} — 營業 ${from} ~ ${to}`]).font = { bold: true, size: 14 }
    ws.addRow([])
    const header = ws.addRow(HEADERS)
    header.font = { bold: true }
    header.alignment = { horizontal: 'center', vertical: 'middle' }
    header.eachCell((cell, col) => {
      cell.fill = col <= 3 ? HEADER_FILL : INPUT_FILL
    })
    gridRow(header)

    for (const r of rows) {
      const line = ws.addRow([`${r.date} ${weekdayOf(r.date)}`, ...KEYS.map((k) => r[k])])
      line.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 1 && MONEY_KEYS.has(KEYS[col - 2])) cell.numFmt = MONEY_FMT
        if (col >= 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4FAFE' } }
      })
      gridRow(line)
    }

    const { total, average } = bizTotals(rows)
    for (const [label, src, fmtCounts] of [
      ['Total', total, 'General'],
      ['平均', average, '#,##0.0'],
    ]) {
      const line = ws.addRow([label, ...KEYS.map((k) => src[k])])
      line.font = { bold: true }
      line.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.fill = TOTAL_FILL
        if (col > 1) cell.numFmt = MONEY_KEYS.has(KEYS[col - 2]) ? MONEY_FMT : fmtCounts
      })
      gridRow(line)
    }

    ws.columns.forEach((col, i) => {
      col.width = i === 0 ? 18 : 13
    })
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }]
  }
  return wb
}

export async function exportBizExcel({ stores, from, to }) {
  const blocks = await collect(stores, from, to)
  const wb = await buildBizRangeWorkbook({ blocks, from, to })
  await download(wb, `營業_${from}_${to}.xlsx`)
}

// ---------------------------------------------------------------------------
// 週匯出
// ---------------------------------------------------------------------------

// One sheet: per store a block of three columns (日期 | 營業額 | 杯數) for the
// seven days Monday-Sunday, store name on top, blocks side by side. 營業額 is
// the 總營業額 and 杯數 the 總杯數.
export async function buildBizWeekWorkbook({ blocks, monday }) {
  const wb = await newWorkbook()
  const ws = wb.addWorksheet(`Week ${monday}`)
  const dates = datesBetween(monday, addDays(monday, 6))

  const names = []
  const headers = []
  blocks.forEach(({ store }) => {
    names.push(store.name, null, null)
    headers.push('日期', '營業額', '杯數')
  })
  ws.addRow(names).font = { bold: true }
  ws.addRow(headers)
  dates.forEach((date, i) => {
    const [y, m, d] = date.split('-').map(Number)
    const cells = []
    blocks.forEach(({ rows }) => {
      cells.push(new Date(Date.UTC(y, m - 1, d)), rows[i].total, rows[i].cups)
    })
    ws.addRow(cells)
  })

  ws.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.alignment = { horizontal: rowNumber <= 2 && col % 3 !== 1 ? 'center' : 'right' }
      if (rowNumber > 2) {
        const kind = (col - 1) % 3
        if (kind === 0) cell.numFmt = 'd/mm/yyyy'
        else if (kind === 1) cell.numFmt = '0.00'
        else cell.numFmt = '0'
      }
    })
  })
  for (let c = 1; c <= blocks.length * 3; c++) ws.getColumn(c).width = (c - 1) % 3 === 0 ? 12 : 11
  // names sit over the first column of their block, left-aligned like the template
  blocks.forEach((_, i) => {
    ws.getCell(1, i * 3 + 1).alignment = { horizontal: 'left' }
    ws.getCell(2, i * 3 + 1).alignment = { horizontal: 'left' }
  })
  return wb
}

export async function exportBizWeek({ stores, monday }) {
  if (!isMonday(monday)) throw new Error('週匯出要從星期一開始。')
  const blocks = await collect(stores, monday, addDays(monday, 6))
  const wb = await buildBizWeekWorkbook({ blocks, monday })
  await download(wb, `營業週報_${safeName(monday)}.xlsx`)
}
