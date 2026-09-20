// `extraWide` is for a modal that shows a live side-by-side preview next to
// its own form (Edit Item's Preview panel) — wider than the normal `wide`
// two-field-grid case, since it needs room for a second column.
//
// `dismissable = false` is for a modal the user must act inside before it
// can close (e.g. a forced Quick Quiz) — it hides the ✕ and stops a
// backdrop click from closing it; the caller still closes it explicitly
// (e.g. a "Done" button in its own footer/content) once the required step
// is complete.
export default function Modal({ open, onClose, title, children, footer, wide = false, extraWide = false, dismissable = true }) {
  if (!open) return null
  const widthClass = extraWide ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-lg'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose?.()}
    >
      <div className={`w-full ${widthClass} max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-xl border border-brand-100`}>
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
