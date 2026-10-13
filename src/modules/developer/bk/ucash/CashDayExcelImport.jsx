import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { filterKeepExistingCashDays, parseCashDayRows, readWorkbookRows } from '../bkImport'
import { monthLabel } from '../bkUtils'
import { Notice } from '../bkUi'

// Point 5: backfill 分店現金's daily grid (實 CA / D / 入庫) from Excel. Same
// preview-then-套用 pattern as Sales figure's import — nothing is saved until
// 儲存 is pressed on the sheet itself. Default: a day the grid already has a
// number for is left alone (system data wins); 覆蓋 opts back into file-wins.
export default function CashDayExcelImport({ file, year, month, cashDays, onApply, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [overwrite, setOverwrite] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sheet = await readWorkbookRows(await file.arrayBuffer())
        const result = parseCashDayRows(sheet.rows, { year, month })
        if (!cancelled) setState({ result, sheetName: sheet.name })
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, year, month])

  const { result } = state
  const kept = useMemo(() => (result ? filterKeepExistingCashDays(result.entries, cashDays) : { entries: {}, skipped: 0 }), [result, cashDays])
  const toApply = overwrite ? result?.entries : kept.entries
  const canApply = !!result && !result.error && Object.keys(toApply ?? {}).length > 0

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`匯入 Excel — ${monthLabel(year, month)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!canApply} onClick={() => onApply(toApply)}>
            套用到表格
          </Button>
        </>
      }
    >
      {state.loading && <LoadingSpinner label="讀取檔案…" />}
      {state.failed && <Notice kind="error">{state.failed}</Notice>}
      {result?.error && <Notice kind="error">{result.error}</Notice>}
      {result && !result.error && (
        <div className="space-y-3 text-sm">
          <div className="text-gray-500">
            檔案：{file.name}
            {state.sheetName ? `（工作表：${state.sheetName}）` : ''}
          </div>

          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            覆蓋表格現有的數字（預設不覆蓋：表格已經有數字的格子，匯入會跳過；入庫勾選只會從未勾變已勾，不會取消勾選）
          </label>

          {result.dayCount > 0 ? (
            <Notice kind="ok">
              可匯入 {result.dayCount} 天、{result.cellCount} 個數字。套用後只是填進表格，要按「儲存」才會存起來。
              {!overwrite && kept.skipped > 0 && <span className="ml-1">其中 {kept.skipped} 格表格已經有數字，不會匯入。</span>}
            </Notice>
          ) : (
            <Notice kind="error">這個檔案裡沒有屬於 {monthLabel(year, month)} 的可匯入資料。</Notice>
          )}

          {result.otherMonths.length > 0 && (
            <Notice kind="info">
              檔案裡有其他月份的資料（{result.otherMonths.join('、')}）沒有匯入。要匯入那個月，請先把畫面切到該月份再匯入。
            </Notice>
          )}
          {result.unreadable > 0 && <Notice kind="info">有 {result.unreadable} 列的日期看不懂，已略過。</Notice>}
          {result.badCells > 0 && <Notice kind="info">有 {result.badCells} 格不是數字，已略過。</Notice>}
          {result.notes.map((n) => (
            <Notice key={n} kind="info">
              {n}
            </Notice>
          ))}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 font-semibold text-brand-900">有對應到的欄位（{result.mapped.length}）</div>
              <ul className="space-y-1">
                {result.mapped.map((m) => (
                  <li key={m.header} className="rounded bg-green-50 px-2 py-1">
                    {m.header} <span className="text-gray-400">→</span> {m.target}
                  </li>
                ))}
                {result.mapped.length === 0 && <li className="text-gray-400">沒有任何欄位對得上</li>}
              </ul>
            </div>
            <div>
              <div className="mb-1 font-semibold text-brand-900">不會匯入的欄位（{result.ignored.length}）</div>
              <ul className="space-y-1">
                {result.ignored.map((m) => (
                  <li key={m.header} className="rounded bg-gray-50 px-2 py-1">
                    {m.header} <span className="text-gray-400">— {m.reason}</span>
                  </li>
                ))}
                {result.ignored.length === 0 && <li className="text-gray-400">無</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
