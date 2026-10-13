import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { countOverwrites, filterKeepExisting, parseSfRows, readWorkbookRows } from '../bkImport'
import { monthLabel } from '../bkUtils'
import { Notice } from '../bkUi'

// Preview step of "匯入 Excel": reads the chosen file, shows how its columns
// were matched and what would change, and only on 套用 hands the values to the
// sheet (still unsaved there). Empty cells in the file never clear anything.
// Point 5 default: when the sheet already has a number in a cell, the file's
// value for that cell is skipped (system data wins) — the person can tick
// "覆蓋" to go back to the old file-wins behaviour.
export default function SfExcelImport({ file, columns, year, month, days, onApply, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [overwrite, setOverwrite] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sheet = await readWorkbookRows(await file.arrayBuffer())
        const result = parseSfRows(sheet.rows, { year, month, columns })
        if (!cancelled) setState({ result, sheetName: sheet.name })
      } catch (e) {
        if (!cancelled) setState({ failed: `無法讀取這個檔案（需要 .xlsx 格式）：${e.message}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, columns, year, month])

  const { result } = state
  const overwrites = result ? countOverwrites(result.entries, days) : 0
  const kept = useMemo(() => (result ? filterKeepExisting(result.entries, days) : { entries: {}, skipped: 0 }), [result, days])
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
            覆蓋表格現有的數字（預設不覆蓋：表格已經有數字的格子，匯入會跳過，保留表格原本的數字）
          </label>

          {result.dayCount > 0 ? (
            <Notice kind="ok">
              可匯入 {result.dayCount} 天、{result.cellCount} 個數字。套用後只是填進表格，要按「儲存」才會存起來；檔案裡空白的格子不會清掉表格原有的數字。
              {!overwrite && kept.skipped > 0 && <span className="ml-1">其中 {kept.skipped} 格表格已經有數字，不會匯入。</span>}
              {overwrite && overwrites > 0 && <strong className="ml-1 text-red-600">其中 {overwrites} 格會覆蓋表格現有的不同數字。</strong>}
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
