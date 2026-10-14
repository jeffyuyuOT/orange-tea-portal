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
export default function SalesFigureTab({ stores, salesStores, topActive = true, typesVersion, jumpTarget, onJumpHandled, onStoresChanged, onTabDirty, registerSaver }) {
  const today = brisbaneToday()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)
  const dirtyRef = useRef(false)
  const saveRef = useRef(null)
  const tabDirtyRef = useRef(onTabDirty)
  tabDirtyRef.current = onTabDirty
  const onDirtyChange = useCallback((d) => {
    dirtyRef.current = d
    tabDirtyRef.current?.(d)
  }, [])
  // The sheet's "save as draft"; also what BK's 儲存 button calls.
  const onSaveReady = useCallback(
    (fn) => {
      saveRef.current = fn
      registerSaver?.('sf', fn)
    },
    [registerSaver]
  )

  // Every store / month change (from inside the SF sheet, or a "載入" jump
  // from 歷史紀錄) goes through here. Typing that was not submitted is kept
  // as a draft (no question asked); if that save fails we stay where we are.
  const navigate = useCallback(async (next) => {
    if (dirtyRef.current && saveRef.current) {
      const ok = await saveRef.current()
      if (!ok) return false
    }
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
      salesStores={salesStores}
      store={store}
      year={year}
      month={month}
      typesVersion={typesVersion}
      active={topActive}
      onNavigate={navigate}
      onDirtyChange={onDirtyChange}
      onSaveReady={onSaveReady}
    />
  )
}
