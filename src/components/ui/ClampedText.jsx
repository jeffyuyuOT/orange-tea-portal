import { useLayoutEffect, useRef, useState } from 'react'
import Modal from './Modal'

// Jeff, 2026-10-19: long titles / questions used to share a half-width column
// with their badges and buttons on a phone. This shows the text over the full
// row width, at most `lines` lines; if it is cut off a "…" button appears at
// the end and opens the full text in a window.
export default function ClampedText({ text, title = 'Full text', lines = 3, className = '' }) {
  const ref = useRef(null)
  const [clipped, setClipped] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [text, lines])

  return (
    <div className="relative min-w-0">
      <div
        ref={ref}
        className={`break-words ${className}`}
        style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden' }}
      >
        {text}
      </div>
      {clipped && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
          className="absolute bottom-0 right-0 rounded bg-white px-1.5 text-sm font-bold leading-tight text-brand-600 shadow-[-6px_0_6px_white] hover:text-brand-800"
          aria-label="Show full text"
          title="Show full text"
        >
          •••
        </button>
      )}
      {/* React events bubble through the tree even for fixed-position popups, so
          without this a click on the popup's ✕ / backdrop reached the row's own
          "open editor" onClick. */}
      <div onClick={(e) => e.stopPropagation()}>
        <Modal open={open} onClose={() => setOpen(false)} title={title}>
          <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{text}</p>
        </Modal>
      </div>
    </div>
  )
}
