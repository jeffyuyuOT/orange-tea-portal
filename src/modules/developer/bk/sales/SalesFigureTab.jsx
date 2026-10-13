import { useCallback, useEffect, useRef, useState } from 'react'
import { brisbaneToday } from '../bkUtils'
import SfSheet from './SfSheet'
import StoreManager from './StoreManager'

// Sales figure: just the SF sheet itself. 歷史紀錄 moved to the top-level
// 歷史紀錄 tab (history/HistoryTab.jsx, re-using sales/SfHistory.jsx) and
// 資料維護 moved to 系統設置 (settings/SettingsTab.jsx, re-using
// sales/SfMaintenance.jsx) — with only one sub-view left here, there's no
// sub-tab bar any more. `typesVersion` is now owned by BkPage (bumped by
// 系統設置's SF payment-type editor) so the sheet re-reads its columns after
// a change made from that other tab.
export default function SalesFigureTab({ stores, topActive = true, typesVersion, jumpTarget, onJumpHandled, onStoresChanged }) {
  const today = brisbaneToday()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)
  const dirtyRef = useRef(false)
  const onDirtyChange = useCallback((d) => {
    dirtyRef.current = d
  }, [])

  // Every store / month change (from inside the SF sheet, or a "載入" jump
  // from 歷史紀錄) goes through here so unsaved edits are never dropped silently.
  const navigate = useCallback((next) => {
    if (dirtyRef.current && !window.confirm('這個月的 SF 有未儲存的變更，確定要離開並捨棄嗎？')) return false
    if (next.storeId) setStoreId(next.storeId)
    if (next.year) setYear(next.year)
    if (next.month) setMonth(next.month)
    return true
  }, [])

  useEffect(() => {
    if (!jumpTarget) return
    navigate(jumpTarget)
    onJumpHandled?.()
  }, [jumpTarget, navigate, onJumpHandled])

  const store = stores.find((s) => s.id === storeId) ?? stores[0]
  // No stores yet (or all deleted): nothing to show except where to add one.
  if (!store) return <StoreManager stores={stores} onChanged={onStoresChanged} />

  return (
    <SfSheet
      stores={stores}
      store={store}
      year={year}
      month={month}
      typesVersion={typesVersion}
      active={topActive}
      onNavigate={navigate}
      onDirtyChange={onDirtyChange}
    />
  )
}
