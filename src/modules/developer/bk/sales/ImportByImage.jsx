import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { countOverwrites, filterKeepExisting } from '../bkImport'
import { draftToEntries, textToDraft } from '../bkImageImport'
import { ocrReportImage } from '../bkImageOcr'
import { fmtMoney, monthLabel } from '../bkUtils'
import { MoneyInput, Notice, inputCls } from '../bkUi'

// 「匯入 by 圖檔」: pick a file or paste a screenshot of the POS report
// (Sale Summary › Payments), read it in the browser (tesseract.js, nothing is
// uploaded), and show a review step. 套用 only fills the sheet — it never saves.
//   image's Cash -> O.CA, its Total -> O.POST, Eftpos + Eftpos offline -> POS eftpos,
//   every other line -> the payment type of the same name.
// Every number in the review step can be edited, and the date too. Like the Excel
// import, cells the sheet already holds are skipped unless 覆蓋 is ticked.
export default function ImportByImage({ columns, year, month, days, onApply }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(null) // object URL
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [reading, setReading] = useState(null) // null | progress 0..1
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null) // review step is open while this is set
  const fileRef = useRef(null)

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  function take(f) {
    if (!f || !f.type.startsWith('image/')) return
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(f)
    })
    setFile(f)
    setName(f.name || '貼上的圖片')
    setError('')
  }

  // 刪除圖片: drop the picture (and its object URL) so another one can be picked / pasted.
  function remove() {
    setPreview(null)
    setFile(null)
    setName('')
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function onPaste(e) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
    if (item) {
      e.preventDefault()
      take(item.getAsFile())
    }
  }

  async function start() {
    if (!file) return
    setError('')
    setReading(0)
    try {
      const text = await ocrReportImage(file, (p) => setReading(p))
      const d = textToDraft(text)
      if (d.lines.length === 0) {
        setError('圖片裡讀不到任何 payment 行。請確認截圖是 POS 的 Sale Summary 的 Payments 頁，字不要太小或被遮住，再試一次。')
      } else {
        setDraft(d)
      }
    } catch (e) {
      setError(`圖片辨識失敗：${e.message}（第一次使用需要連網下載辨識程式）`)
    } finally {
      setReading(null)
    }
  }

  return (
    <div className="rounded-xl border border-brand-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-brand-800"
      >
        <span>匯入 by 圖檔</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-brand-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*" className="text-sm" onChange={(e) => take(e.target.files?.[0])} />
            <span className="text-xs text-gray-400">或點下方方框後直接貼上（Ctrl+V）複製的圖片</span>
          </div>
          <div
            tabIndex={0}
            onPaste={onPaste}
            className="flex min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-brand-200 bg-brand-50/40 p-3 text-sm text-gray-500 focus:border-brand-400 focus:outline-none"
          >
            {preview ? (
              <div className="space-y-1 text-center">
                <img src={preview} alt={name} className="mx-auto max-h-56 rounded border border-brand-100" />
                <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                  <span>{name}</span>
                  <button
                    type="button"
                    onClick={remove}
                    className="rounded border border-red-200 px-2 py-0.5 text-red-600 hover:bg-red-50"
                  >
                    刪除圖片
                  </button>
                </div>
              </div>
            ) : (
              '在這裡貼上圖片'
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!file || reading !== null}
              onClick={start}
              className="rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-200"
            >
              {reading !== null ? `辨識中… ${Math.round(reading * 100)}%` : '開始匯入'}
            </button>
            <span className="text-xs text-gray-400">圖片只在這台電腦的瀏覽器裡辨識，不會上傳。辨識完會先讓你檢查再填進表格。</span>
          </div>
          {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
        </div>
      )}

      {draft && (
        <ImageReview
          draft={draft}
          imageUrl={preview}
          columns={columns}
          year={year}
          month={month}
          days={days}
          onClose={() => setDraft(null)}
          onApply={(entries) => {
            onApply(entries, '圖檔')
            setDraft(null)
          }}
        />
      )}
    </div>
  )
}

// The review step: what was read (editable), where it goes, and what would change.
function ImageReview({ draft: initial, imageUrl, columns, year, month, days, onClose, onApply }) {
  const [draft, setDraft] = useState(initial)
  const [overwrite, setOverwrite] = useState(false)

  const view = useMemo(() => draftToEntries(draft, { year, month, columns }), [draft, year, month, columns])
  const parsed = view.result
  const kept = useMemo(() => filterKeepExisting(parsed.entries, days), [parsed, days])
  const overwrites = countOverwrites(parsed.entries, days)
  const toApply = overwrite ? parsed.entries : kept.entries
  const canApply = !parsed.error && Object.keys(toApply).length > 0

  const setLine = (i, patch) => setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`匯入 by 圖檔 — ${monthLabel(year, month)}`}
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
      <div className="space-y-3 text-sm">
        <p className="text-xs text-gray-500">請對照原圖檢查每個數字，可以直接改。套用後只是填進表格，要按「提交」才會存起來。</p>

        {draft.fixed && (
          <Notice kind="info">
            「{draft.fixed.label}」原本讀成 {fmtMoney(draft.fixed.from)}，因為各項加總要等於 Total，已自動改成 {fmtMoney(draft.fixed.to)}。請對照原圖確認。
          </Notice>
        )}
        {!draft.hadTotal && <Notice kind="error">圖片裡沒有讀到 Total 那一行，沒辦法用加總檢查數字，請特別仔細對照原圖，並自己填上 Total。</Notice>}
        {draft.date && draft.dateTo && draft.date !== draft.dateTo && (
          <Notice kind="error">
            圖片的期間是 {draft.date} 到 {draft.dateTo}，不是單一天。這個匯入一次只填一天，請重新截取只有一天的報表。
          </Notice>
        )}

        {imageUrl && <img src={imageUrl} alt="原圖" className="max-h-48 rounded border border-brand-100" />}

        <label className="flex items-center gap-2">
          <span className="font-medium text-brand-900">日期</span>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            className={inputCls}
          />
          {!draft.date && <span className="text-xs text-red-600">沒有讀到日期，請選一天</span>}
        </label>

        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="bg-brand-100 text-left text-xs">
              <th className="border border-brand-100 px-2 py-1">圖片上的名稱</th>
              <th className="w-32 border border-brand-100 px-2 py-1 text-right">金額</th>
              <th className="border border-brand-100 px-2 py-1">填到</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((l, i) => (
              <tr key={i}>
                <td className="border border-gray-100 p-0">
                  <input
                    value={l.label}
                    onChange={(e) => setLine(i, { label: e.target.value })}
                    className="w-full bg-transparent px-2 py-1 focus:bg-white focus:outline-none"
                    aria-label="名稱"
                  />
                </td>
                <td className="border border-gray-100 p-0">
                  <MoneyInput value={l.amount} onChange={(v) => setLine(i, { amount: v })} />
                </td>
                <td className="border border-gray-100 px-2 py-1 text-xs">{targetOf(l.label, view)}</td>
              </tr>
            ))}
            <tr className="bg-brand-50 font-semibold">
              <td className="border border-gray-100 px-2 py-1">Total</td>
              <td className="border border-gray-100 p-0">
                <MoneyInput value={draft.total} onChange={(v) => setDraft((d) => ({ ...d, total: v }))} />
              </td>
              <td className="border border-gray-100 px-2 py-1 text-xs">O.POST</td>
            </tr>
          </tbody>
        </table>

        {view.totalAmount !== null &&
          (view.sumOk ? (
            <Notice kind="ok">各項加總 {fmtMoney(view.sum)} = Total，數字對得上。</Notice>
          ) : (
            <Notice kind="error">
              各項加總 {fmtMoney(view.sum)} ≠ Total {fmtMoney(view.totalAmount)}（差 {fmtMoney(view.sum - view.totalAmount)}），代表有數字讀錯了，請對照原圖修正。
            </Notice>
          ))}
        {!view.hasCash && <Notice kind="info">圖片裡沒有 Cash 那一行，O.CA 不會填。</Notice>}

        {view.merged.some((l) => !l.target) && (
          <Notice kind="info">
            {view.merged
              .filter((l) => !l.target)
              .map((l) => l.label)
              .join('、')}
            ：這間分店沒有同名的 payment type，不會匯入。要匯入的話請先到「資料維護」新增，或把左邊的名稱改成這間分店的 payment type 名稱。
          </Notice>
        )}

        <label className="flex items-center gap-1.5 text-gray-700">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          覆蓋表格現有的數字（預設不覆蓋：表格已經有數字的格子，匯入會跳過）
        </label>

        {parsed.error && <Notice kind="error">{parsed.error}</Notice>}
        {!parsed.error && parsed.dayCount > 0 && (
          <Notice kind="ok">
            可匯入 {parsed.dayCount} 天、{parsed.cellCount} 個數字。
            {!overwrite && kept.skipped > 0 && <span className="ml-1">其中 {kept.skipped} 格表格已經有數字，不會匯入。</span>}
            {overwrite && overwrites > 0 && <strong className="ml-1 text-red-600">其中 {overwrites} 格會覆蓋表格現有的不同數字。</strong>}
          </Notice>
        )}
        {!parsed.error && parsed.dayCount === 0 && draft.date && parsed.otherMonths.length === 0 && (
          <Notice kind="error">沒有可匯入的數字。</Notice>
        )}
        {parsed.otherMonths.length > 0 && (
          <Notice kind="error">
            圖片的日期（{parsed.otherMonths.join('、')}）不在目前畫面的 {monthLabel(year, month)}。請先把畫面切到那個月份再匯入。
          </Notice>
        )}
      </div>
    </Modal>
  )
}

// What a picture line fills: Cash -> O.CA, Eftpos lines -> POS eftpos, a matched
// payment type, or "不會匯入".
function targetOf(label, view) {
  const key = String(label).replace(/\s+/g, ' ').trim().toLowerCase()
  if (key === 'cash') return 'O.CA'
  if (key === 'eftpos' || key === 'eftpos offline') {
    const m = view.merged.find((l) => l.label === 'POS eftpos')
    return m?.target ? `${m.target.name}（Eftpos 相加）` : <span className="text-gray-400">不會匯入（沒有 POS eftpos）</span>
  }
  const m = view.merged.find((l) => l.label === label)
  return m?.target?.name ?? <span className="text-gray-400">不會匯入（沒有這個 payment type）</span>
}
