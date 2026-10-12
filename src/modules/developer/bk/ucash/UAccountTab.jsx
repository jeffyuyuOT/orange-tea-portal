import { useCallback, useRef, useState } from 'react'
import { brisbaneToday } from '../bkUtils'
import { Notice, SubTabs } from '../bkUi'
import StoreCashPanel from './StoreCashPanel'
import EntriesManager from './EntriesManager'
import UHistory from './UHistory'

const SUBTABS = [
  ['cash', '分店現金'],
  ['entries', '新增編輯收支'],
  ['history', '歷史紀錄'],
]

// U帳: 分店現金 | 新增編輯收支 | 歷史紀錄. 分店現金 stays mounted while the
// other sub-tabs are open so typed-in 實 CA / D values aren't lost.
export default function UAccountTab({ stores, topActive = true }) {
  const today = brisbaneToday()
  const [sub, setSub] = useState('cash')
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)
  // Bumped whenever a 收支 entry is added / edited / deleted anywhere, so
  // 分店現金 re-reads its lists.
  const [entriesVersion, setEntriesVersion] = useState(0)
  const dirtyRef = useRef(false)
  const onDirtyChange = useCallback((d) => {
    dirtyRef.current = d
  }, [])

  const navigate = useCallback((next) => {
    if (dirtyRef.current && !window.confirm('分店現金有未儲存的變更，確定要離開並捨棄嗎？')) return false
    if (next.storeId) setStoreId(next.storeId)
    if (next.year) setYear(next.year)
    if (next.month) setMonth(next.month)
    return true
  }, [])

  const store = stores.find((s) => s.id === storeId) ?? stores[0]
  if (!store) {
    return <Notice kind="info">還沒有任何分店。請先到 Sales figure › 資料維護 › 分店管理 新增分店。</Notice>
  }
  const bump = () => setEntriesVersion((v) => v + 1)

  return (
    <div className="space-y-4">
      <SubTabs tabs={SUBTABS} value={sub} onChange={setSub} />
      <div className={sub === 'cash' ? '' : 'hidden'}>
        <StoreCashPanel
          stores={stores}
          store={store}
          year={year}
          month={month}
          active={topActive && sub === 'cash'}
          entriesVersion={entriesVersion}
          onNavigate={navigate}
          onDirtyChange={onDirtyChange}
          onEntriesChanged={bump}
        />
      </div>
      {sub === 'entries' && (
        <EntriesManager
          stores={stores}
          store={store}
          // The entries tab only switches store; the cash sheet's month is untouched.
          onNavigate={(next) => navigate({ storeId: next.storeId })}
          onEntriesChanged={bump}
        />
      )}
      <div className={sub === 'history' ? '' : 'hidden'}>
        <UHistory
          stores={stores}
          storeId={store.id}
          active={topActive && sub === 'history'}
          onLoad={(target) => navigate(target) && setSub('cash')}
        />
      </div>
    </div>
  )
}
