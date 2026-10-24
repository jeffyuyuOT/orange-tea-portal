// 系統設置 > 匯入: downloadable .xlsx templates for each of the five BK
// surfaces, with the exact header names bkImport.js's parsers look for plus
// one example row. Filenames double as the routing hint — SettingsTab.jsx
// guesses which importer to use from the uploaded file's name, and these are
// what that file is named if the person re-uploads it unchanged.
import { newWorkbook, download } from './bkExcel'
import { loadPaymentTypes } from './bkData'
import { buildColumns } from './bkUtils'
import { loadHourSettings } from './bkHourData'
import { DEFAULT_HOURS, hourLabel } from './bkHourly'

function headerRow(ws, headers) {
  const row = ws.addRow(headers)
  row.font = { bold: true }
  ws.columns.forEach((col, i) => {
    col.width = Math.max(14, (headers[i]?.length ?? 0) * 1.6)
  })
}

async function buildTemplate(sheets) {
  const wb = await newWorkbook()
  for (const { name, headers, example, note } of sheets) {
    const ws = wb.addWorksheet(name)
    if (note) {
      ws.addRow([note]).font = { italic: true, color: { argb: 'FF888888' } }
      ws.addRow([])
    }
    headerRow(ws, headers)
    if (example) ws.addRow(example)
  }
  return wb
}

// Excel worksheet names can't be blank, can't exceed 31 chars, and can't
// contain \ / ? * [ ] : — exported so BackfillGridImport.jsx can derive the
// exact same name from a store to look its tab back up on import.
const FORBIDDEN_SHEET_CHARS = /[\\/?*[\]:]/g
export function sheetNameForStore(name) {
  return String(name).replace(FORBIDDEN_SHEET_CHARS, ' ').trim().slice(0, 31) || 'Store'
}

// Same header shape parseSfRows() actually reads for a given store's
// payment types: Cash / Pos total are computed (never typed into), a column
// with subs is typed via its subs (each labelled "Sub (Parent)" same as the
// sheet's own export), and a plain column is typed directly.
function sfTemplateHeaders(columns) {
  const headers = ['Date']
  for (const col of columns) {
    if (col.name === 'Cash' || col.name === 'Pos total') continue
    if (col.subs.length > 0) {
      for (const sub of col.subs) headers.push(`${sub.name} (${col.name})`)
    } else {
      headers.push(col.name)
    }
  }
  headers.push('O.CA', 'O.POST')
  return headers
}

// One tab per store, each with that store's own payment-type columns (not
// just the generic Date/O.CA/O.POST fields) — so this template round-trips
// through BackfillGridImport exactly like a single store's own Sales figure
// 匯入 Excel would, for every store at once.
export async function downloadSfTemplate(stores) {
  const wb = await newWorkbook()
  for (const store of stores) {
    const types = await loadPaymentTypes(store.id)
    const columns = buildColumns(types)
    const headers = sfTemplateHeaders(columns)
    const ws = wb.addWorksheet(sheetNameForStore(store.name))
    ws.addRow([`${store.name} — 這個分店目前設定的 payment type 欄位`]).font = { italic: true, color: { argb: 'FF888888' } }
    ws.addRow([])
    headerRow(ws, headers)
    ws.addRow(headers.map((h) => (h === 'Date' ? '2026-10-05' : h === 'O.CA' ? 1234.56 : h === 'O.POST' ? 1500 : 0)))
  }
  await download(wb, 'BK匯入範本_SF.xlsx')
}

export async function downloadUAccountTemplate() {
  const wb = await buildTemplate([
    {
      name: '分店現金',
      note: 'U > 分店現金的每日數字（只支援通用欄位，不含期初餘額）。',
      headers: ['Date', 'Store', '實CA', 'D', '入庫'],
      example: ['2026-10-05', 'Sunnybank', 2000, 500, '是'],
    },
    {
      name: '收支',
      note: 'U > 收支：Type 填 Icost / Ucost / 其他收入 / Deposit / Withdraw / 入金 / 分店transfer。入金另外需要「入金對象」欄（Jeff bank / Mao 保險箱 / 其他）；分店transfer 需要 From / To 兩個分店欄，Mode 留白代表一般 transfer，填「借貸償還」代表借貸償還。',
      headers: ['Date', 'Store', 'Type', 'Amount', 'Description', 'Note', '入金對象', 'From', 'To', 'Mode'],
      example: ['2026-10-05', 'Sunnybank', 'Icost', 120, '買清潔用品', '', '', '', '', ''],
    },
  ])
  await download(wb, 'BK匯入範本_U.xlsx')
}

export async function downloadDividendTemplate() {
  const wb = await buildTemplate([
    {
      name: '收成',
      note: 'Type 填 income（入金）/ cost / payout。income 的 Method 填 Bank（進 Jeff B）/ Cash（進 Mao保）/ 其他（進「其他」，留白也是其他）。party_expense（Party自身支出）只需要 Party，不用 Method，不動金庫。payout 另外需要 Party（這個分店設定好的 party 名稱）跟 Method（Bank / Cash）。cost 一定要填 Method：Bank 從 Jeff B 扣、Cash 從 Mao保 扣、其他 從「其他」扣、金庫外 不動金庫（領取收成時才扣）。',
      headers: ['Date', 'Store', 'Type', 'Party', 'Method', 'Amount', 'Note'],
      example: ['2026-10-05', 'Sunnybank', 'cost', '', 'Bank', 300, '維修費'],
    },
  ])
  await download(wb, 'BK匯入範本_收成.xlsx')
}

export async function downloadJeffOwedTemplate() {
  const wb = await buildTemplate([
    {
      name: '機件Jeff',
      note: 'Type 填 薪水 / 預付 / 預拿。薪水如果本來就是從 payroll 計算表自動抓的，這裡只用來補登不在那張表裡的薪水。Store 可以留白，留白的話會算到 Sunnybank。',
      headers: ['Date', 'Store', 'Type', 'Description', 'Amount', 'Note'],
      example: ['2026-10-05', 'Sunnybank', '預付', '出差墊款', 500, ''],
    },
  ])
  await download(wb, 'BK匯入範本_機件Jeff.xlsx')
}

export async function downloadEmmaClaimTemplate() {
  const wb = await buildTemplate([
    {
      name: '機件Emma',
      note: '每一列是一筆歷史的 bonus 領取紀錄（提交日期 + 總金額），不會對應到特定的 U 入金明細 — 那些明細只有當時在系統裡建立的紀錄才有。',
      headers: ['Date', 'Amount', 'Note'],
      example: ['2026-09-01', 450, '9 月份 bonus'],
    },
  ])
  await download(wb, 'BK匯入範本_機件Emma.xlsx')
}

// 小時統計: one tab per SF / U帳 store, rows = dates, columns = hours (the hours set
// for that store in 系統設置 › 小時統計). Cells are the hour's 營業額 with POS and
// self-order already added together.
export async function downloadHourTemplate(stores) {
  const settings = Object.fromEntries((await loadHourSettings()).map((r) => [r.store_id, { start: r.start_hour, end: r.end_hour }]))
  const wb = await newWorkbook()
  for (const store of stores) {
    const { start, end } = settings[store.id] ?? DEFAULT_HOURS
    const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i)
    const ws = wb.addWorksheet(sheetNameForStore(store.name))
    ws.addRow([`${store.name} — 每小時營業額（POS 和自動點單已加總）。日期要寫完整（例如 2026-10-05）；小時欄可以自己增減，表頭寫 9:00 這樣。`]).font = { italic: true, color: { argb: 'FF888888' } }
    ws.addRow([])
    headerRow(ws, ['日期', ...hours.map(hourLabel)])
    ws.addRow(['2026-10-05', ...hours.map((h, i) => (i % 3 === 2 ? '' : 100 + h * 5))])
  }
  await download(wb, 'BK匯入範本_HA.xlsx')
}

// 營業: one tab per 營業 store, same columns the 營業 tab exports (the two
// computed ones, 總營業額 / 總杯數, are left out — they would be ignored).
export async function downloadBizTemplate(salesStores) {
  const wb = await newWorkbook()
  for (const store of salesStores) {
    const ws = wb.addWorksheet(sheetNameForStore(store.name))
    ws.addRow([
      store.sf_store_id
        ? `${store.name} — 連結SF：POS 讀SF的 O.POST，匯入時 POS 欄會略過（可留空）`
        : `${store.name} — 營業：POS 手動輸入`,
    ]).font = { italic: true, color: { argb: 'FF888888' } }
    ws.addRow([])
    const headers = ['日期', 'P杯數', 'POS', 'CV', 'Self O', 'SO杯數']
    headerRow(ws, headers)
    ws.addRow(['2026-10-05', 120, store.sf_store_id ? '' : 1500, 3, 400, 40])
  }
  await download(wb, 'BK匯入範本_營業.xlsx')
}
