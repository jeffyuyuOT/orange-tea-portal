// 系統設置 > 匯入: downloadable .xlsx templates for each of the five BK
// surfaces, with the exact header names bkImport.js's parsers look for plus
// one example row. Filenames double as the routing hint — SettingsTab.jsx
// guesses which importer to use from the uploaded file's name, and these are
// what that file is named if the person re-uploads it unchanged.
import { newWorkbook, download } from './bkExcel'
import { loadPaymentTypes } from './bkData'
import { buildColumns } from './bkUtils'

// Every import file writes dates as DD/MM/YY (e.g. 05/10/26). The Date column is
// formatted that way, and the example dates are real dates, so typing 5/10/26
// into it in Excel keeps working. (The importer also still reads 2026-10-05 and DD/MM/YYYY.)
const DATE_FORMAT = 'dd/mm/yy'
const DATE_NOTE = '日期格式：DD/MM/YY（例如 05/10/26）。'
const asDate = (v) => {
  const m = typeof v === 'string' ? v.match(/^(\d{2})\/(\d{2})\/(\d{2})$/) : null
  return m ? new Date(Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : v
}

function headerRow(ws, headers) {
  const row = ws.addRow(headers)
  row.font = { bold: true }
  ws.columns.forEach((col, i) => {
    col.width = Math.max(14, (headers[i]?.length ?? 0) * 1.6)
  })
  headers.forEach((h, i) => {
    if (h === 'Date' || h === '日期' || h === '入金日期') ws.getColumn(i + 1).numFmt = DATE_FORMAT
  })
}

async function buildTemplate(sheets) {
  const wb = await newWorkbook()
  for (const { name, headers, example, examples, note } of sheets) {
    const ws = wb.addWorksheet(name)
    if (note) {
      ws.addRow([note]).font = { italic: true, color: { argb: 'FF888888' } }
      ws.addRow([])
    }
    headerRow(ws, headers)
    if (example) ws.addRow(example.map(asDate))
    for (const ex of examples ?? []) ws.addRow(ex.map(asDate))
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
    ws.addRow([`${store.name} — 這個分店目前設定的 payment type 欄位。${DATE_NOTE}`]).font = { italic: true, color: { argb: 'FF888888' } }
    ws.addRow([])
    headerRow(ws, headers)
    ws.addRow(headers.map((h) => (h === 'Date' ? asDate('05/10/26') : h === 'O.CA' ? 1234.56 : h === 'O.POST' ? 1500 : 0)))
  }
  await download(wb, 'BK匯入範本_SF.xlsx')
}

export async function downloadUAccountTemplate() {
  const wb = await buildTemplate([
    {
      name: '分店現金',
      note: `U帳 > 分店現金的每日數字（只支援通用欄位，不含期初餘額）。${DATE_NOTE}`,
      headers: ['Date', 'Store', '實CA', 'D', '入庫'],
      example: ['05/10/26', 'Sunnybank', 2000, 500, '是'],
    },
    {
      name: '收支',
      note: `${DATE_NOTE}U帳 > 收支：Type 填 Icost / Ucost / 其他收入 / Deposit / Withdraw / 入金 / 分店transfer。入金另外需要「入金對象」欄（Jeff bank / Mao 保險箱 / 其他）；分店transfer 需要 From / To 兩個分店欄，Mode 留白代表一般 transfer，填「借貸償還」代表借貸償還。`,
      headers: ['Date', 'Store', 'Type', 'Amount', 'Description', 'Note', '入金對象', 'From', 'To', 'Mode'],
      example: ['05/10/26', 'Sunnybank', 'Icost', 120, '買清潔用品', '', '', '', '', ''],
    },
  ])
  await download(wb, 'BK匯入範本_U帳.xlsx')
}

export async function downloadDividendTemplate() {
  const wb = await buildTemplate([
    {
      name: '收成',
      note: `${DATE_NOTE}Type 填 income（入金）/ cost / payout。income 的 Method 填 Bank（進 Jeff B）/ Cash（進 Mao保）/ 其他（進「其他」，留白也是其他）。party_expense（Party自身支出）只需要 Party，不用 Method，不動金庫。payout 另外需要 Party（這個分店設定好的 party 名稱）跟 Method（Bank / Cash）。cost 一定要填 Method：Bank 從 Jeff B 扣、Cash 從 Mao保 扣、其他 從「其他」扣、金庫外 不動金庫（領取收成時才扣）。`,
      headers: ['Date', 'Store', 'Type', 'Party', 'Method', 'Amount', 'Note'],
      example: ['05/10/26', 'Sunnybank', 'cost', '', 'Bank', 300, '維修費'],
    },
  ])
  await download(wb, 'BK匯入範本_收成.xlsx')
}

export async function downloadJeffOwedTemplate() {
  const wb = await buildTemplate([
    {
      name: '積欠Jeff',
      note: `${DATE_NOTE}Type 填 薪水 / 預付 / 預拿。薪水如果本來就是從 payroll 計算表自動抓的，這裡只用來補登不在那張表裡的薪水。一筆紀錄只有一個 Date：如果是一段期間（例如薪水 1 號到 14 號），Date 填期間的最後一天，期間寫在 Description（例如「01/10/26–14/10/26 薪水」）。`,
      headers: ['Date', 'Type', 'Description', 'Amount', 'Note'],
      example: ['14/10/26', '薪水', '01/10/26–14/10/26 薪水', 1200, ''],
    },
  ])
  await download(wb, 'BK匯入範本_積欠Jeff.xlsx')
}

export async function downloadEmmaClaimTemplate() {
  const wb = await buildTemplate([
    {
      name: '積欠Emma',
      note: `${DATE_NOTE}每一列是一筆 Sunnybank 入金：Date = 這次 bonus 領取（提交）的日期，入金日期 / 入金金額 = 那筆入金，入金對象填 Jeff B / Mao保 / 其他（留白 = 其他）。Date 相同的列會合成一筆 bonus 紀錄，Bonus 金額 = 這些入金總和的 10%。系統裡已經有的同日期、同金額、同入金對象的入金會自動對應，不會再被重複領 bonus。`,
      headers: ['Date', '入金日期', '入金金額', '入金對象', 'Note'],
      examples: [
        ['14/10/26', '01/10/26', 1200, 'Jeff B', ''],
        ['14/10/26', '07/10/26', 800, 'Mao保', '現金入金'],
        ['14/10/26', '09/10/26', 500, '其他', ''],
      ],
    },
  ])
  await download(wb, 'BK匯入範本_積欠Emma.xlsx')
}

// 營業: one tab per 營業 store, same columns the 營業 tab exports (the two
// computed ones, 總營業額 / 總杯數, are left out — they would be ignored).
export async function downloadBizTemplate(salesStores) {
  const wb = await newWorkbook()
  for (const store of salesStores) {
    const ws = wb.addWorksheet(sheetNameForStore(store.name))
    ws.addRow([
      store.sf_store_id
        ? `${store.name} — 連結 SF：POS 讀 SF 的 O.POST，匯入時 POS 欄會略過（可留空）。${DATE_NOTE}`
        : `${store.name} — 營業：POS 手動輸入。${DATE_NOTE}`,
    ]).font = { italic: true, color: { argb: 'FF888888' } }
    ws.addRow([])
    const headers = ['日期', 'P杯數', 'POS', 'CV', 'Self O', 'SO杯數']
    headerRow(ws, headers)
    ws.addRow([asDate('05/10/26'), 120, store.sf_store_id ? '' : 1500, 3, 400, 40])
  }
  await download(wb, 'BK匯入範本_營業.xlsx')
}
