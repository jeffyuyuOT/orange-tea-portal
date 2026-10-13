// 系統設置 > 匯入: downloadable .xlsx templates for each of the five BK
// surfaces, with the exact header names bkImport.js's parsers look for plus
// one example row. Filenames double as the routing hint — SettingsTab.jsx
// guesses which importer to use from the uploaded file's name, and these are
// what that file is named if the person re-uploads it unchanged.
import { newWorkbook, download } from './bkExcel'

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

export async function downloadSfTemplate() {
  const wb = await buildTemplate([
    {
      name: 'SF',
      note: '只支援 Date / Store / O.CA / O.POST 這幾個通用欄位（不含各分店自訂的 payment type 明細）。要匯入某個分店某個月份完整的 SF 明細，請到 Sales figure 那個月份的頁面用「匯入 Excel」。',
      headers: ['Date', 'Store', 'O.CA', 'O.POST'],
      example: ['2026-10-05', 'Sunnybank', 1234.56, 1500],
    },
  ])
  await download(wb, 'BK匯入範本_SF.xlsx')
}

export async function downloadUAccountTemplate() {
  const wb = await buildTemplate([
    {
      name: '分店現金',
      note: 'U帳 > 分店現金的每日數字（只支援通用欄位，不含期初餘額）。',
      headers: ['Date', 'Store', '實CA', 'D', '入庫'],
      example: ['2026-10-05', 'Sunnybank', 2000, 500, '是'],
    },
    {
      name: '收支',
      note: 'U帳 > 收支：Type 填 Icost / Ucost / 其他收入 / Deposit / Withdraw / 入金 / 分店transfer。入金另外需要「入金對象」欄（Jeff bank / Mao 保險箱 / 其他）；分店transfer 需要 From / To 兩個分店欄，Mode 留白代表一般 transfer，填「借貸償還」代表借貸償還。',
      headers: ['Date', 'Store', 'Type', 'Amount', 'Description', 'Note', '入金對象', 'From', 'To', 'Mode'],
      example: ['2026-10-05', 'Sunnybank', 'Icost', 120, '買清潔用品', '', '', '', '', ''],
    },
  ])
  await download(wb, 'BK匯入範本_U帳.xlsx')
}

export async function downloadDividendTemplate() {
  const wb = await buildTemplate([
    {
      name: '分紅',
      note: 'Type 填 income / cost / payout。payout 另外需要 Party（這個分店設定好的 party 名稱）跟 Method（Bank / Cash）。',
      headers: ['Date', 'Store', 'Type', 'Party', 'Method', 'Amount', 'Note'],
      example: ['2026-10-05', 'Sunnybank', 'cost', '', '', 300, '維修費'],
    },
  ])
  await download(wb, 'BK匯入範本_分紅.xlsx')
}

export async function downloadJeffOwedTemplate() {
  const wb = await buildTemplate([
    {
      name: '積欠Jeff',
      note: 'Type 填 薪水 / 預付 / 預拿。薪水如果本來就是從 payroll 計算表自動抓的，這裡只用來補登不在那張表裡的薪水。',
      headers: ['Date', 'Type', 'Description', 'Amount', 'Note'],
      example: ['2026-10-05', '預付', '出差墊款', 500, ''],
    },
  ])
  await download(wb, 'BK匯入範本_積欠Jeff.xlsx')
}

export async function downloadEmmaClaimTemplate() {
  const wb = await buildTemplate([
    {
      name: '積欠Emma',
      note: '每一列是一筆歷史的 bonus 領取紀錄（提交日期 + 總金額），不會對應到特定的 U帳 入金明細 — 那些明細只有當時在系統裡建立的紀錄才有。',
      headers: ['Date', 'Amount', 'Note'],
      example: ['2026-09-01', 450, '9 月份 bonus'],
    },
  ])
  await download(wb, 'BK匯入範本_積欠Emma.xlsx')
}
