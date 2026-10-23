// Excel exports for the BK page (Sales figure month, U帳 store-cash month).
// exceljs is loaded on demand so it stays out of the main bundle.
import {
  computeSfDay,
  computeSfTotals,
  computeCashDay,
  computeCashSummary,
  monthDates,
  monthLabel,
  weekdayOf,
  dwSigned,
  ENTRY_KIND_LABELS,
  RUJU_TARGET_LABELS,
} from './bkUtils'

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFED7AA' } }
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } }
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00'

export async function newWorkbook() {
  const ExcelJS = (await import('exceljs')).default
  return new ExcelJS.Workbook()
}

export async function download(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function styleHeader(row) {
  row.font = { bold: true }
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.border = { bottom: { style: 'thin' } }
  })
}

function styleTotal(row) {
  row.font = { bold: true }
  row.eachCell((cell) => {
    cell.fill = TOTAL_FILL
    cell.border = { top: { style: 'thin' } }
  })
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')

// Same column order as the on-screen sheet: Date | mains… | Total | Check | subs… | O.CA | O.POST
// Builds the workbook (no download) so tests and the Excel import can round-trip it.
// `kioskMap` ({ [date]: 營業 Self O }, optional): for a store linked to the 營業
// tab, fills a day's empty Self order kiosk the same way the sheet does.
export async function buildSfWorkbook({ storeName, year, month, columns, days, dMap, kioskMap }) {
  const wb = await newWorkbook()
  const ws = wb.addWorksheet(monthLabel(year, month))
  const subs = columns.flatMap((c) => c.subs.map((s) => ({ ...s, parentName: c.name })))
  ws.addRow([`${storeName} — 消費展望 ${monthLabel(year, month)}`]).font = { bold: true, size: 14 }
  ws.addRow([])
  styleHeader(
    ws.addRow(['Date', ...columns.map((c) => c.name), 'Total', 'Sum vs Total', ...subs.map((s) => `${s.name} (${s.parentName})`), 'O.CA', 'O.POST'])
  )

  const rows = []
  for (const date of monthDates(year, month)) {
    const day = days[date] ?? { amounts: {} }
    const r = computeSfDay(columns, day, dMap[date] ?? null, kioskMap ? (kioskMap[date] ?? null) : undefined)
    rows.push(r)
    const cells = [
      `${date} ${weekdayOf(date)}`,
      ...columns.map((c) => r.mains[c.id]),
      r.total,
      r.check === 'ok' ? '✓' : r.check === 'bad' ? '✗' : '',
      ...subs.map((s) => r.subAmounts[s.id]),
      r.oCa,
      r.oPost,
    ]
    ws.addRow(cells)
  }
  const t = computeSfTotals(columns, rows)
  styleTotal(ws.addRow(['Total', ...columns.map((c) => t.mains[c.id]), t.total, '', ...subs.map((s) => t.subs[s.id]), t.oCa, t.oPost]))

  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 16 : 14
    if (i > 0) col.numFmt = MONEY_FMT
  })
  const checkCol = columns.length + 3
  ws.getColumn(checkCol).alignment = { horizontal: 'center' }
  ws.getColumn(checkCol).numFmt = 'General'
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }]
  return wb
}

export async function exportSfXlsx(args) {
  const wb = await buildSfWorkbook(args)
  await download(wb, `SF_${safeName(args.storeName)}_${monthLabel(args.year, args.month)}.xlsx`)
}

// One sheet: summary, daily table, then the D/W, Icost, Ucost and 入金 lists.
export async function exportCashXlsx({ storeName, year, month, open, sfDaysMap, cashDaysMap, entries }) {
  const wb = await newWorkbook()
  const ws = wb.addWorksheet(monthLabel(year, month))
  const dates = monthDates(year, month)
  const dayRows = dates.map((date) => ({ date, ...computeCashDay(sfDaysMap[date], cashDaysMap[date]) }))
  const s = computeCashSummary(open.coh, open.ucoh, dayRows, entries)

  ws.addRow([`${storeName} — Stock lost 分店現金 ${monthLabel(year, month)}`]).font = { bold: true, size: 14 }
  ws.addRow([])
  styleHeader(ws.addRow(['COH', 'UCOH', 'D + +/− (未入庫)', 'P/L']))
  ws.addRow([s.coh, s.ucoh, s.dUnstocked, s.pl])
  ws.addRow(['上月月底 COH', open.coh, '上月月底 UCOH', open.ucoh])
  ws.addRow([])

  styleHeader(ws.addRow(['Date', 'O.CA', '實 CA', '+/−', 'D', '入庫', '消費展望 cash']))
  for (const r of dayRows) {
    ws.addRow([`${r.date} ${weekdayOf(r.date)}`, r.oCa, r.actual, r.pm, r.d, r.stocked ? '✓' : '', r.sfCash])
  }
  styleTotal(ws.addRow(['Total', s.totals.oCa, s.totals.actual, s.totals.pm, s.totals.d, '', s.totals.sfCash]))
  ws.addRow([])

  const block = (title, headers, list, total) => {
    ws.addRow([title]).font = { bold: true }
    styleHeader(ws.addRow(headers))
    for (const row of list) ws.addRow(row)
    styleTotal(ws.addRow(['Total', ...Array(headers.length - 2).fill(''), total]))
    ws.addRow([])
  }
  const by = (kinds) => entries.filter((e) => kinds.includes(e.kind))
  block(
    'D/W',
    ['Date', 'Type', 'Amount', 'Note'],
    by(['deposit', 'withdraw']).map((e) => [e.entry_date, ENTRY_KIND_LABELS[e.kind], dwSigned(e), e.note ?? '']),
    s.entryTotals.dw
  )
  block(
    'Icost',
    ['Date', 'Description', 'Amount', 'Note'],
    by(['icost']).map((e) => [e.entry_date, e.description ?? '', Number(e.amount), e.note ?? '']),
    s.entryTotals.icost
  )
  block(
    'Ucost',
    ['Date', 'Description', 'Amount', 'Note'],
    by(['ucost']).map((e) => [e.entry_date, e.description ?? '', Number(e.amount), e.note ?? '']),
    s.entryTotals.ucost
  )
  block(
    '其他收入',
    ['Date', 'Description', 'Amount', 'Note'],
    by(['other_income']).map((e) => [e.entry_date, e.description ?? '', Number(e.amount), e.note ?? '']),
    s.entryTotals.otherIncome
  )
  block(
    '入金',
    ['Date', 'Type', 'Amount', 'Note'],
    by(['ruju']).map((e) => [e.entry_date, RUJU_TARGET_LABELS[e.ruju_target] ?? '', Number(e.amount), e.note ?? '']),
    s.entryTotals.ruju
  )

  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 20 : 16
  })
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      if (typeof cell.value === 'number') cell.numFmt = MONEY_FMT
    })
  )
  await download(wb, `UAccount_${safeName(storeName)}_${monthLabel(year, month)}.xlsx`)
}

// 歷史紀錄 > P/L: one row per (分店 if shown) + 月份, with a Total row.
export async function exportPlXlsx({ title, rows, total, showStore }) {
  const wb = await newWorkbook()
  const sheetName = safeName(title).slice(0, 31) || 'P_L'
  const ws = wb.addWorksheet(sheetName)
  ws.addRow([title]).font = { bold: true, size: 14 }
  ws.addRow([])
  const headers = showStore ? ['分店', '月份', 'P/L'] : ['月份', 'P/L']
  styleHeader(ws.addRow(headers))
  for (const r of rows) {
    ws.addRow(showStore ? [r.storeName, r.monthLabel, r.pl] : [r.monthLabel, r.pl])
  }
  styleTotal(ws.addRow(showStore ? ['Total', '', total] : ['Total', total]))

  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 20 : 16
  })
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      if (typeof cell.value === 'number') cell.numFmt = MONEY_FMT
    })
  )
  await download(wb, `${safeName(title)}.xlsx`)
}
