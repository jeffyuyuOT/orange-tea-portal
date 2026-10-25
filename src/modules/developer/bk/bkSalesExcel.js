// Excel exports for the BK 營業 tab: "Excel 匯出" (a date range, one tab per
// store) and "週匯出" (one Monday-to-Sunday week, every store side by side).
// exceljs is loaded on demand (via bkExcel) so it stays out of the main bundle.
import { download, newWorkbook } from './bkExcel'
import { loadSalesRange, loadSfPostRange } from './bkSalesData'
import { addDays, bizDayRow, bizTotals, datesBetween, dmy, isMonday } from './bkSalesUtils'
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

// ---------------------------------------------------------------------------
// 週匯出 — 圖片 (Jeff, 2026-10-25: "能直接產生圖片可以複製圖片直接貼在line聊天
// 裡嗎? 圖片格式就跟之前匯出excel檔格式一樣就好") — same side-by-side layout as
// buildBizWeekWorkbook above, drawn onto a plain <canvas> instead of an
// .xlsx sheet (no extra library), so BizExportModal can copy it straight to
// the clipboard for pasting into a LINE chat, with a PNG download as the
// fallback for a browser that won't let a page write an image to the
// clipboard.
// ---------------------------------------------------------------------------

const IMG_COL_DATE = 100
const IMG_COL_NUM = 85
const IMG_ROW_NAME = 30
const IMG_ROW_HEADER = 28
const IMG_ROW_DATA = 26
const IMG_PAD = 10
const IMG_SCALE = 2 // drawn at 2x so the pasted image stays sharp, not blurry

const imgMoney = (n) => (n === null || n === undefined ? '' : n.toFixed(2))
const imgCups = (n) => (n === null || n === undefined ? '' : String(Math.round(n)))

// Draws the week's blocks onto a canvas at IMG_SCALE pixel density. Returns
// the canvas plus its logical (unscaled) CSS width/height, for the caller to
// size an <img> preview with.
export function renderBizWeekCanvas(blocks, monday) {
  const dates = datesBetween(monday, addDays(monday, 6))
  const blockW = IMG_COL_DATE + IMG_COL_NUM * 2
  const width = IMG_PAD * 2 + blockW * blocks.length
  const bodyTop = IMG_PAD + IMG_ROW_NAME + IMG_ROW_HEADER
  const height = bodyTop + IMG_ROW_DATA * dates.length + IMG_PAD

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * IMG_SCALE)
  canvas.height = Math.round(height * IMG_SCALE)
  const ctx = canvas.getContext('2d')
  ctx.scale(IMG_SCALE, IMG_SCALE)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'middle'

  blocks.forEach(({ store, rows }, bi) => {
    const x0 = IMG_PAD + bi * blockW
    const colX = [x0, x0 + IMG_COL_DATE, x0 + IMG_COL_DATE + IMG_COL_NUM, x0 + blockW]
    const headerY = IMG_PAD + IMG_ROW_NAME

    // store name — left-aligned over the block, same as the template
    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif'
    ctx.fillStyle = '#111827'
    ctx.textAlign = 'left'
    ctx.fillText(store.name, x0 + 6, IMG_PAD + IMG_ROW_NAME / 2)

    // header band (日期 / 營業額 / 杯數) — same fill as the Excel header cells
    ctx.fillStyle = '#FED7AA'
    ctx.fillRect(x0, headerY, blockW, IMG_ROW_HEADER)
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif'
    ctx.textAlign = 'center'
    ;['日期', '營業額', '杯數'].forEach((h, ci) => ctx.fillText(h, (colX[ci] + colX[ci + 1]) / 2, headerY + IMG_ROW_HEADER / 2))

    // 7 day rows, d/mm/yyyy | 營業額 (2dp) | 杯數 (whole number) — same
    // formatting buildBizWeekWorkbook's numFmt uses, just drawn as text
    ctx.font = '12px "Segoe UI", Arial, sans-serif'
    dates.forEach((date, ri) => {
      const y = bodyTop + ri * IMG_ROW_DATA
      if (ri % 2 === 1) {
        ctx.fillStyle = '#F4FAFE'
        ctx.fillRect(x0, y, blockW, IMG_ROW_DATA)
        ctx.fillStyle = '#111827'
      }
      ctx.textAlign = 'left'
      ctx.fillText(dmy(date), colX[0] + 6, y + IMG_ROW_DATA / 2)
      ctx.textAlign = 'right'
      ctx.fillText(imgMoney(rows[ri].total), colX[2] - 6, y + IMG_ROW_DATA / 2)
      ctx.fillText(imgCups(rows[ri].cups), colX[3] - 6, y + IMG_ROW_DATA / 2)
    })

    // gridlines for this block
    ctx.strokeStyle = '#BFBFBF'
    ctx.lineWidth = 1
    const hLines = [headerY, headerY + IMG_ROW_HEADER]
    for (let r = 1; r <= dates.length; r++) hLines.push(bodyTop + r * IMG_ROW_DATA)
    hLines.forEach((y) => {
      ctx.beginPath()
      ctx.moveTo(x0, Math.round(y) + 0.5)
      ctx.lineTo(x0 + blockW, Math.round(y) + 0.5)
      ctx.stroke()
    })
    colX.forEach((x) => {
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, headerY)
      ctx.lineTo(Math.round(x) + 0.5, bodyTop + dates.length * IMG_ROW_DATA)
      ctx.stroke()
    })
  })

  return { canvas, width, height }
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))), 'image/png')
  )
}

// Collects the same data exportBizWeek uses and draws it as a PNG — returns
// the blob plus a data URL for an inline preview and the logical width/
// height to size that preview with, without triggering any download itself
// (BizExportModal decides whether to copy it to the clipboard or fall back
// to downloadBizWeekImageBlob below).
export async function buildBizWeekImage({ stores, monday }) {
  if (!isMonday(monday)) throw new Error('週匯出要從星期一開始。')
  const blocks = await collect(stores, monday, addDays(monday, 6))
  const { canvas, width, height } = renderBizWeekCanvas(blocks, monday)
  const blob = await canvasToPngBlob(canvas)
  return { blob, dataUrl: canvas.toDataURL('image/png'), filename: `營業週報_${safeName(monday)}.png`, width, height }
}

export function downloadBizWeekImageBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
