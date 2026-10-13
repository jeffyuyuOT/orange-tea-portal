import { useEffect, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { Notice, SubTabs, inputCls } from '../bkUi'
import { listWorkbookSheetNames } from '../bkImport'
import { loadDividendData } from '../bkDividendData'
import { exportBkBackup, restoreBkBackup } from '../bkBackup'
import {
  downloadDividendTemplate,
  downloadEmmaClaimTemplate,
  downloadJeffOwedTemplate,
  downloadSfTemplate,
  downloadUAccountTemplate,
  sheetNameForStore,
} from '../bkImportTemplates'
import BackfillGridImport from './BackfillGridImport'
import EntriesExcelImport from '../ucash/EntriesExcelImport'
import DividendExcelImport from '../bonus/DividendExcelImport'
import JeffOwedExcelImport from './JeffOwedExcelImport'
import EmmaClaimExcelImport from './EmmaClaimExcelImport'
import SfMaintenance from '../sales/SfMaintenance'
import PartySettings from '../bonus/PartySettings'

const SUBTABS = [
  ['import', '匯入'],
  ['backup', '備份'],
  ['sf', 'SF'],
  ['bonus', '收成'],
]

// SF's template has one tab per store (each with that store's own payment-
// type columns), so it needs the full store list; the others are generic.
const TEMPLATES = [
  ['SF', (stores) => downloadSfTemplate(stores)],
  ['U帳', () => downloadUAccountTemplate()],
  ['收成', () => downloadDividendTemplate()],
  ['積欠 Jeff', () => downloadJeffOwedTemplate()],
  ['積欠 Emma', () => downloadEmmaClaimTemplate()],
]

// Filename -> which pipeline to run, checked in this order (Jeff/Emma first
// since "積欠Jeff"/"積欠Emma" would otherwise also match the U帳/積欠 pattern).
const ROUTES = [
  ['jeff', /jeff/i, '積欠 Jeff'],
  ['emma', /emma/i, '積欠 Emma'],
  ['bonus', /收成|dividend|bonus/i, '收成'],
  ['u', /u\s*帳|u\s*account|ucash|分店現金|收支/i, 'U帳'],
  // Not \bsf\b: JS treats "_" as a word character, so "範本_SF" has no word
  // boundary before the S. Only ASCII letters count as a neighbour here, which
  // still lets "_SF", " SF 202607" and "SF202607" match but not "transfer".
  ['sf', /(^|[^a-z])sf([^a-z]|$)|sales\s*figure/i, 'SF'],
]
const ROUTE_LABEL = Object.fromEntries(ROUTES.map(([k, , label]) => [k, label]))

function guessKind(filename) {
  return ROUTES.find(([, re]) => re.test(filename))?.[0] ?? null
}

// U帳's template puts 分店現金 and 收支 in one workbook as two sheets — these
// pick out which sheet is which by name so each half can be routed to its own
// importer instead of just grabbing whichever sheet comes first.
const CASH_SHEET_RE = /分店現金|現金|cash/i
const ENTRIES_SHEET_RE = /收支|entries?/i

// 系統設置 > 匯入／備份.
//   匯入: download the 5 templates, then upload a file — routed to the right
//   importer by its filename (falling back to a manual chooser when the name
//   doesn't say). SF and U帳 > 分店現金 are sheet-style grids and ask for a
//   Store + 年月 first (via BackfillGridImport); U帳 > 收支, 收成 and 積欠 are
//   append-only ledgers that write straight to the database with automatic
//   dedup, no separate 儲存 step.
//   備份: BK's own export/restore (see bkBackup.js for why this is kept
//   separate from the portal-wide 備份 under 系統設定).
//   SF / 收成: SfMaintenance (payment types + 分店管理) and PartySettings
//   (收成 party 設置), moved here from the Sales figure / 收成 tabs — those
//   are configuration, not day-to-day entry, so they live alongside the rest
//   of this tab's setup-and-maintenance surfaces instead of cluttering the
//   tabs people use every day.
export default function SettingsTab({ stores, onStoresChanged, onPaymentTypesChanged }) {
  const [sub, setSub] = useState('import')
  const [templateChoice, setTemplateChoice] = useState(TEMPLATES[0][0])
  const [file, setFile] = useState(null)
  const [kind, setKind] = useState(null)
  const [uSheets, setUSheets] = useState(null)
  const [uPipeline, setUPipeline] = useState(null) // 'cash' | 'entries'
  const [dividendData, setDividendData] = useState(null)
  const [error, setError] = useState('')
  const [importedMsg, setImportedMsg] = useState('')
  const fileInputRef = useRef(null)

  const [restoreResults, setRestoreResults] = useState(null)
  const backupInputRef = useRef(null)

  useEffect(() => {
    if (!file || kind !== 'u' || uSheets) return
    let cancelled = false
    ;(async () => {
      try {
        const names = await listWorkbookSheetNames(await file.arrayBuffer())
        const cash = names.find((n) => CASH_SHEET_RE.test(n)) ?? null
        const entries = names.find((n) => ENTRIES_SHEET_RE.test(n)) ?? null
        if (!cancelled) setUSheets({ cash, entries })
      } catch (e) {
        if (!cancelled) setError(`無法讀取這個檔案：${e.message}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, kind, uSheets])

  // 收成's data is needed both by the 匯入 pipeline (dedup against existing
  // rows) and by the 收成 sub-tab's party settings — loaded once, shared.
  useEffect(() => {
    if ((kind !== 'bonus' && sub !== 'bonus') || dividendData) return
    let cancelled = false
    ;(async () => {
      try {
        const d = await loadDividendData()
        if (!cancelled) setDividendData(d)
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [kind, sub, dividendData])

  async function reloadDividendData() {
    try {
      setDividendData(await loadDividendData())
    } catch (e) {
      setError(e.message)
    }
  }

  function pickFile(f) {
    setError('')
    setImportedMsg('')
    setFile(f)
    const byName = guessKind(f.name)
    setKind(byName)
    setUSheets(null)
    setUPipeline(null)
    if (!byName) guessKindFromSheets(f)
  }

  // Fallback when the filename says nothing: look at the sheet names. A U帳
  // workbook has 分店現金 / 收支 sheets; an SF workbook has one sheet per store.
  async function guessKindFromSheets(f) {
    try {
      const names = await listWorkbookSheetNames(await f.arrayBuffer())
      let guess = null
      if (names.some((n) => CASH_SHEET_RE.test(n) || ENTRIES_SHEET_RE.test(n))) {
        guess = 'u'
      } else {
        const storeSheets = new Set((stores ?? []).map((s) => sheetNameForStore(s.name).toLowerCase()))
        if (names.some((n) => storeSheets.has(String(n).trim().toLowerCase()))) guess = 'sf'
      }
      // Ignore the result if the user picked another file or a kind meanwhile.
      if (guess) setKind((cur) => cur ?? guess)
    } catch {
      // Unreadable here; the real importer will report it. Manual chooser stays.
    }
  }

  function reset() {
    setFile(null)
    setKind(null)
    setUSheets(null)
    setUPipeline(null)
  }

  function imported(count, label) {
    setImportedMsg(`已匯入 ${count} 筆（${label}）。`)
    reset()
  }

  async function doExport() {
    setError('')
    await exportBkBackup()
  }

  async function doRestore(f) {
    if (!window.confirm('還原備份會覆蓋系統裡所有符合的 BK 資料（依相同的 id 比對覆蓋），且不會刪除備份裡沒有的資料。確定要繼續嗎？')) return
    setError('')
    setRestoreResults(null)
    try {
      setRestoreResults(await restoreBkBackup(f))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <SubTabs tabs={SUBTABS} value={sub} onChange={setSub} />
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

      {sub === 'import' && (
        <div className="max-w-3xl space-y-4">
          {importedMsg && <Notice kind="ok" onClose={() => setImportedMsg('')}>{importedMsg}</Notice>}

          <div className="space-y-2 rounded-xl border border-brand-100 bg-white p-4">
            <div className="text-sm font-semibold text-brand-900">下載匯入範本</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={inputCls}
                value={templateChoice}
                onChange={(e) => setTemplateChoice(e.target.value)}
                aria-label="選擇範本"
              >
                {TEMPLATES.map(([label]) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={templateChoice === 'SF' && stores.length === 0}
                onClick={() => TEMPLATES.find(([label]) => label === templateChoice)?.[1](stores)}
              >
                下載範本
              </Button>
            </div>
            {templateChoice === 'SF' && (
              <div className="text-xs text-gray-500">
                {stores.length === 0 ? '還沒有任何分店，無法產生 SF 範本。' : 'SF 範本每個分店各自一個分頁，欄位是該分店目前設定的 payment type。'}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-brand-100 bg-white p-4">
            <div className="text-sm font-semibold text-brand-900">上傳檔案</div>
            <div className="text-xs text-gray-500">
              系統會根據檔名判斷匯入哪個分頁（檔名含「SF」「U帳」「收成」「Jeff」「Emma」）。檔名看不出來的話可以手動選擇。
            </div>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              選擇 Excel 檔案
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) pickFile(f)
              }}
            />

            {file && (
              <div className="space-y-3 rounded-lg bg-brand-50/60 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    檔案：{file.name}
                    {kind ? (
                      <span className="ml-2 text-brand-700">→ 判斷為「{ROUTE_LABEL[kind]}」</span>
                    ) : (
                      <span className="ml-2 text-red-600">→ 看不出屬於哪個分頁</span>
                    )}
                  </div>
                  <Button variant="ghost" onClick={reset}>
                    移除檔案
                  </Button>
                </div>

                {!kind && (
                  <div className="flex flex-wrap gap-2">
                    {ROUTES.map(([k, , label]) => (
                      <Button key={k} variant="secondary" onClick={() => setKind(k)}>
                        {label}
                      </Button>
                    ))}
                  </div>
                )}

                {kind === 'sf' &&
                  (stores.length === 0 ? (
                    <Notice kind="info">還沒有任何分店，無法匯入 SF。</Notice>
                  ) : (
                    <BackfillGridImport
                      file={file}
                      kind="sf"
                      stores={stores}
                      onClose={reset}
                      onImported={(count) => imported(count, 'SF')}
                    />
                  ))}

                {kind === 'u' &&
                  (stores.length === 0 ? (
                    <Notice kind="info">還沒有任何分店，無法匯入 U帳。</Notice>
                  ) : !uSheets ? (
                    <LoadingSpinner label="讀取檔案…" />
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs text-gray-500">
                        檔案裡找到：{uSheets.cash ? `「${uSheets.cash}」（分店現金）` : '沒有分店現金的工作表'}
                        {' ／ '}
                        {uSheets.entries ? `「${uSheets.entries}」（收支）` : '沒有收支的工作表'}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => setUPipeline('cash')}>匯入分店現金</Button>
                        <Button onClick={() => setUPipeline('entries')}>匯入收支</Button>
                      </div>
                      {uPipeline === 'cash' && (
                        <BackfillGridImport
                          file={file}
                          kind="cashday"
                          stores={stores}
                          sheetNames={uSheets.cash ? [uSheets.cash] : undefined}
                          onClose={() => setUPipeline(null)}
                          onImported={(count) => imported(count, 'U帳 > 分店現金')}
                        />
                      )}
                      {uPipeline === 'entries' && (
                        <EntriesExcelImport
                          file={file}
                          stores={stores}
                          defaultStoreId={stores[0]?.id ?? null}
                          sheetNames={uSheets.entries ? [uSheets.entries] : undefined}
                          onClose={() => setUPipeline(null)}
                          onImported={(count) => imported(count, 'U帳 > 收支')}
                        />
                      )}
                    </div>
                  ))}

                {kind === 'bonus' &&
                  (stores.length === 0 ? (
                    <Notice kind="info">還沒有任何分店，無法匯入收成。</Notice>
                  ) : !dividendData ? (
                    <LoadingSpinner label="讀取資料…" />
                  ) : (
                    <DividendExcelImport
                      file={file}
                      stores={stores}
                      data={dividendData}
                      onClose={reset}
                      onImported={(count) => imported(count, '收成')}
                    />
                  ))}

                {kind === 'jeff' && (
                  <JeffOwedExcelImport file={file} onClose={reset} onImported={(count) => imported(count, '積欠 Jeff')} />
                )}

                {kind === 'emma' && (
                  <EmmaClaimExcelImport file={file} onClose={reset} onImported={(count) => imported(count, '積欠 Emma')} />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {sub === 'backup' && (
        <div className="max-w-2xl space-y-4">
          <Notice kind="info">
            BK 的備份跟 OT Portal 整體的備份是分開的：整體備份（系統設定）只涵蓋公式／題庫／訓練內容這類參考資料，刻意不包含排班、出勤這類會持續累積的營運資料；BK 的帳本資料屬於同一類——資料量會持續變大、內容也比較敏感，混進整體備份裡會讓那份備份變大又變敏感，而兩邊真正會用到備份的人也不同（開發者 vs 平常維護整體備份的人）。所以 BK 在這裡有自己獨立的匯出／還原，包含所有 BK 的資料表。
          </Notice>

          <div className="flex flex-wrap gap-2">
            <Button onClick={doExport}>匯出備份</Button>
            <Button variant="secondary" onClick={() => backupInputRef.current?.click()}>
              還原備份
            </Button>
          </div>
          <input
            ref={backupInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) doRestore(f)
            }}
          />

          {restoreResults && (
            <div className="overflow-x-auto rounded-xl border border-brand-100">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-100 text-left text-xs text-gray-700">
                  <tr>
                    <th className="px-3 py-2">資料表</th>
                    <th className="px-3 py-2 text-right">筆數</th>
                    <th className="px-3 py-2">結果</th>
                  </tr>
                </thead>
                <tbody>
                  {restoreResults.map((r) => (
                    <tr key={r.table} className="border-t border-gray-100">
                      <td className="px-3 py-2">{r.table}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                      <td className={`px-3 py-2 ${r.error ? 'text-red-600' : 'text-green-600'}`}>{r.error ?? '成功'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className={sub === 'sf' ? '' : 'hidden'}>
        <SfMaintenance
          stores={stores}
          sfStoreId={stores[0]?.id ?? null}
          active={sub === 'sf'}
          onChanged={onPaymentTypesChanged}
          onStoresChanged={onStoresChanged}
        />
      </div>

      <div className={sub === 'bonus' ? '' : 'hidden'}>
        {!dividendData ? (
          <LoadingSpinner label="讀取資料…" />
        ) : (
          <PartySettings stores={stores} data={dividendData} reload={reloadDividendData} />
        )}
      </div>
    </div>
  )
}
