import { useRef, useState } from 'react'

// `extraWide` is for a modal that shows a live side-by-side preview next to
// its own form (Edit Item's Preview panel) — wider than the normal `wide`
// two-field-grid case, since it needs room for a second column.
//
// `dismissable = false` is for a modal the user must act inside before it
// can close (e.g. a forced Quick Quiz) — it hides the ✕ and stops a
// backdrop click from closing it; the caller still closes it explicitly
// (e.g. a "Done" button in its own footer/content) once the required step
// is complete.
//
// `side = true` (Jeff, 2026-11-11, Attendance Exceptions' Edit): parks the dialog at the right
// edge with no click-blocking backdrop, so floating windows on the left of the page (the
// rostered shift being compared against) stay visible and usable while editing. Because
// there is nothing to click outside of, it only closes via ✕ / Cancel / Save.
//
// `anchor = { x, y }` (with `side`, screens 1024px+): instead of the right edge, the dialog
// opens with its top-left corner at that screen position (Attendance Exceptions passes the
// spot of the Clocked window, so it sits over it, right beside the Roster window), and can
// be dragged around by its title bar.
export default function Modal({ open, onClose, title, children, footer, wide = false, extraWide = false, dismissable = true, side = false, anchor = null }) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef(null)
  if (!open) return null
  const widthClass = extraWide ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-lg'
  if (side && anchor && typeof window !== 'undefined' && window.innerWidth >= 1024) {
    const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 528))
    const top = Math.max(8, anchor.y)
    return (
      <div className="pointer-events-none fixed inset-0 z-50">
        <div
          style={{ left, top, transform: `translate(${pos.x}px, ${pos.y}px)`, maxHeight: `calc(100vh - ${top}px - 16px)` }}
          className={`pointer-events-auto absolute w-full ${widthClass} overflow-y-auto rounded-xl border border-brand-100 bg-white shadow-2xl ring-1 ring-black/10`}
        >
          <div
            onPointerDown={(e) => {
              if (e.target.closest('button')) return
              drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (drag.current) setPos({ x: drag.current.ox + e.clientX - drag.current.sx, y: drag.current.oy + e.clientY - drag.current.sy })
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            style={{ touchAction: 'none' }}
            title="Drag to move"
            className="sticky top-0 z-10 flex cursor-move select-none items-center justify-between border-b border-brand-100 bg-white px-5 py-3"
          >
            <h3 className="text-lg font-semibold text-brand-900">{title}</h3>
            {dismissable && (
              <button
                onClick={onClose}
                className="rounded-full p-1 text-gray-400 hover:bg-brand-50 hover:text-brand-600"
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-brand-100 px-5 py-3">{footer}</div>}
        </div>
      </div>
    )
  }
  return (
    <div
      className={
        side
          ? 'pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 lg:justify-end lg:pr-8'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
      }
      onMouseDown={(e) => !side && dismissable && e.target === e.currentTarget && onClose?.()}
    >
      <div className={`${side ? 'pointer-events-auto ring-1 ring-black/10 shadow-2xl' : 'shadow-xl'} w-full ${widthClass} max-h-[85vh] overflow-y-auto rounded-xl bg-white border border-brand-100`}>
        <div className="flex items-center justify-between border-b border-brand-100 px-5 py-3">
          <h3 className="text-lg font-semibold text-brand-900">{title}</h3>
          {dismissable && (
            <button
              onClick={onClose}
              className="rounded-full p-1 text-gray-400 hover:bg-brand-50 hover:text-brand-600"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-brand-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
