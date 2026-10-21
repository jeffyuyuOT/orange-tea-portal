import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import NavBadge from '../ui/NavBadge'

// Jeff, 2026-10-21: "staff time logs還是要在切換分店列表顯示小紅點，因為現在
// 切換到分店不會馬上顯示小紅點，要等一陣子，如果操作快的時候會以為沒有又換到
// 下面一家" — AuthContext's refreshTimeDiscrepancies used to only answer for
// whichever store was currentStoreId, recomputed (asynchronously) right
// after switching — so there was always a real window, right after a
// switch, where a store's dot genuinely hadn't shown up yet even though
// that store did have one. Fixed at the root: AuthContext now precomputes
// storeTimeDiscrepancies for EVERY accessible store up front, so the answer
// for a store this person hasn't even switched to yet is already known —
// nothing to wait for. A plain <select> can't render a coloured dot inside
// an <option> (text only — and on Android a native picker ignores
// per-option styling the same way the old AM/PM <select> did, see
// TypedTimeInput.jsx's 2026-10-08 comment), so this replaces the native
// dropdown with a small custom one that can show NavBadge's dot per store.
export default function StoreSwitcher() {
  const { accessibleStores: allStores, currentStoreId, setCurrentStoreId, storeTimeDiscrepancies } = useAuth()
  // Inside Audit only stores with Audit switched on (Store Management) are offered.
  const onAudit = useLocation().pathname.startsWith('/audit')
  const accessibleStores = onAudit ? allStores.filter((s) => s.audit_enabled) : allStores
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onOutside(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  if (accessibleStores.length <= 1) {
    return accessibleStores.length === 1 ? (
      <span className="text-sm font-medium text-brand-700">{accessibleStores[0].name}</span>
    ) : null
  }

  const current = accessibleStores.find((s) => s.id === currentStoreId)

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-sm font-medium text-brand-800"
      >
        <span>{current?.name ?? '選擇分店'}</span>
        {storeTimeDiscrepancies?.[currentStoreId] && <NavBadge badge={{ dot: true }} />}
        <span className="text-brand-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-full overflow-hidden rounded-lg border border-brand-100 bg-white py-1 shadow-lg">
          {accessibleStores.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setCurrentStoreId(s.id)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between gap-3 whitespace-nowrap px-3 py-1.5 text-left text-sm ${
                s.id === currentStoreId ? 'bg-brand-50 font-semibold text-brand-800' : 'text-gray-700 hover:bg-brand-50'
              }`}
            >
              <span>{s.name}</span>
              {storeTimeDiscrepancies?.[s.id] && <NavBadge badge={{ dot: true }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
