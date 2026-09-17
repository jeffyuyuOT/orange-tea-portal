export default function Modal({ open, onClose, title, children, footer, wide = false }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-xl border border-brand-100`}
      >
        <div className="flex items-center justify-between border-b border-brand-100 px-5 py-3">
          <h3 className="text-lg font-semibold text-brand-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-brand-50 hover:text-brand-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-brand-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
