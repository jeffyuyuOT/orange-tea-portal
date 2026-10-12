import { useCallback, useRef, useState } from 'react'
import { brisbaneToday } from '../bkUtils'
import { SubTabs } from '../bkUi'
import SfSheet from './SfSheet'
import SfHistory from './SfHistory'
import SfMaintenance from './SfMaintenance'
import StoreManager from './StoreManager'

const SUBTABS = [
  ['sf', 'SF'],
  ['history', '歷史紀錄'],
  ['maintenance', '資料維護'],
]

// Sales figure: SF | 歷史紀錄 | 資料維護. The SF sheet stays mounted while the
// other sub-tabs are open so unsaved typing isn't lost by a peek at history.
export default function SalesFigureTab({ stores, topActive = true, onStoresChanged }) {
  const today = brisbaneToday()
  const [sub, setSub] = useState('sf')
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)
  const [typesVersion, setTypesVersion] = useState(0)
  const dirtyRef = useRef(false)
  const onDirtyChange = useCallback((d) => {
    dirtyRef.current = d
  }, [])

  // Every store / month change from inside the SF tab or from history goes
  // through here so unsaved edits are never dropped silently.
  const navigate = useCallback((next) => {
    if (dirtyRef.current && !window.confirm('這個月的 SF 有未儲存的變更，確定要離開並捨棄嗎？')) return false
    if (next.storeId) setStoreId(next.storeId)
    if (next.year) setYear(next.year)
    if (next.month) setMonth(next.month)
    return true
  }, [])

  const store = stores.find((s) => s.id === storeId) ?? stores[0]
  // No stores yet (or all deleted): nothing to show except where to add one.
  if (!store) return <StoreManager stores={stores} onChanged={onStoresChanged} />

  return (
    <div className="space-y-4">
      <SubTabs tabs={SUBTABS} value={sub} onChange={setSub} />
      <div className={sub === 'sf' ? '' : 'hidden'}>
        <SfSheet
          stores={stores}
          store={store}
          year={year}
          month={month}
          typesVersion={typesVersion}
          active={topActive && sub === 'sf'}
          onNavigate={navigate}
          onDirtyChange={onDirtyChange}
        />
      </div>
      <div className={sub === 'history' ? '' : 'hidden'}>
        <SfHistory
          stores={stores}
          sfStoreId={store.id}
          active={topActive && sub === 'history'}
          onLoad={(target) => navigate(target) && setSub('sf')}
        />
      </div>
      <div className={sub === 'maintenance' ? '' : 'hidden'}>
        <SfMaintenance
          stores={stores}
          sfStoreId={store.id}
          active={topActive && sub === 'maintenance'}
          onChanged={() => setTypesVersion((v) => v + 1)}
          onStoresChanged={onStoresChanged}
        />
      </div>
    </div>
  )
}
