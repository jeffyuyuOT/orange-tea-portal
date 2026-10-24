import { useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { monthLabel } from '../bkUtils'
import { Notice } from '../bkUi'
import { loadStoreMonthForSubmit } from './sfSubmitAll'
import { fillMyobFile } from './myobFill'

// 填入會計表: pick the accountant's Excel (sales figure - YYYYMM.xlsx), every store's
// month of Sales figure is written into its sheet, and the filled file is downloaded.
// Nothing but the typed-in cells changes, so the MYOB sheets keep working as they are.
export default function MyobFillModal({ open, onClose, stores, salesStores, year, month }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  function close() {
    setError('')
    setResult(null)
    onClose()
  }

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const months = await Promise.all(stores.map((s) => loadStoreMonthForSubmit(s, salesStores, year, month)))
      const out = await fillMyobFile(buffer, { year, month, months })
      if (out.report.length === 0) throw new Error(out.problems.join('\n') || '這個 Excel 裡找不到任何分店的工作表。')
      const blob = new Blob([out.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setResult(out)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={`填入會計表 · ${monthLabel(year, month)}`}
      footer={<Button onClick={close}>關閉</Button>}
    >
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          選會計用的 Excel（例如 sales figure - 202610.xlsx）。系統把<b>所有分店 {monthLabel(year, month)}</b> 已儲存的SF填進對應的工作表，
          公式和 MYOB 工作表都不動，填好後直接下載。Cash、Pos total 用SF計算出來的數字；Easi 固定填 0。
        </p>
        <label className="inline-block">
          <input type="file" accept=".xlsx" className="hidden" onChange={onPick} disabled={busy} />
          <span className={`inline-block cursor-pointer rounded-lg border border-brand-300 px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50 ${busy ? 'opacity-50' : ''}`}>
            選擇 Excel 並填入
          </span>
        </label>
        {busy && <LoadingSpinner />}
        {error && <Notice kind="error">{error}</Notice>}
        {result && (
          <div className="space-y-2">
            <Notice kind="ok">已填好並下載。請打開檢查一下 Check 欄（Sum vs Total）。</Notice>
            {result.problems.map((p) => (
              <Notice key={p} kind="info">
                {p}
              </Notice>
            ))}
            {result.report.map((r) => (
              <div key={r.sheet} className="rounded-lg border border-brand-100 px-3 py-2">
                <div className="font-semibold text-brand-900">
                  {r.sheet}（{r.store}）{r.notSubmitted && <span className="ml-2 text-xs font-normal text-red-600">這個月還沒提交</span>}
                </div>
                <div className="text-xs text-gray-600">已填：{r.filled.join('、') || '（無）'}</div>
                {r.skipped.length > 0 && <div className="text-xs text-amber-700">找不到對應的 payment type，沒有填：{r.skipped.join('、')}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
