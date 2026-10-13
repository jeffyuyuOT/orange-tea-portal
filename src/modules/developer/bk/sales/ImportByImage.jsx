import { useEffect, useRef, useState } from 'react'
import { Notice } from '../bkUi'

// 「匯入 by 圖檔」entry point. Phase 1 only: pick a file or paste a screenshot
// and see it here. Reading the date / payment types out of the image and
// filling the sheet is the next phase (the image's cash line -> O.CA, its Total ->
// O.POST, Eftpos + Eftpos offline -> POS eftpos; see mergeEftposLines) —
// until then the button says so instead of guessing, and nothing is written to
// the sheet. Everything the import will eventually fill stays hand-editable.
export default function ImportByImage() {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(null) // object URL
  const [name, setName] = useState('')
  const [showSoon, setShowSoon] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  function take(file) {
    if (!file || !file.type.startsWith('image/')) return
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(file)
    })
    setName(file.name || '貼上的圖片')
    setShowSoon(false)
  }

  // 刪除圖片: drop the picture (and its object URL) so another one can be picked / pasted.
  function remove() {
    setPreview(null)
    setName('')
    setShowSoon(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function onPaste(e) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
    if (item) {
      e.preventDefault()
      take(item.getAsFile())
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!preview}
              onClick={() => setShowSoon(true)}
              className="rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-200"
            >
              開始匯入
            </button>
            {showSoon && <Notice kind="info">圖檔辨識（自動讀取日期與 payment type）尚未啟用，下一階段加入。目前請手動輸入。</Notice>}
          </div>
        </div>
      )}
    </div>
  )
}
