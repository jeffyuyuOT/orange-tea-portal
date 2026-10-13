import { useCallback, useEffect, useRef, useState } from 'react'
import { brisbaneToday } from '../bkUtils'
import { Notice, SubTabs } from '../bkUi'
import StoreCashPanel from './StoreCashPanel'
import EntriesManager from './EntriesManager'

const SUBTABS = [
  ['cash', '分店現金'],
  ['entries', '新增編輯收支'],
]

// U帳: 分店現金 | 新增編輯收支. 歷史紀錄 moved to the top-level 歷史紀錄 tab
// (history/HistoryTab.jsx), which re-uses this page's own UHistory.jsx —
// jumping "載入" from there comes back in here via `jumpTarget` (set by
// BkPage) rather than a local sub-tab. 分店現金 stays mounted while 新增編輯收支
// is open so typed-in 實 CA / D values aren't lost.
export default function UAccountTab({ stores, topActive = true, jumpTarget, onJumpHandled }) {
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

  // 歷史紀錄's "載入" (now on a different top-level tab) asks to jump here.
  useEffect(() => {
    if (!jumpTarget) return
    if (navigate(jumpTarget)) setSub('cash')
    onJumpHandled?.()
  }, [jumpTarget, navigate, onJumpHandled])

  const store = stores.find((s) => s.id === storeId) ?? stores[0]
  if (!store) {
    return <Notice kind="info">還沒有任何分店。請先到 系統設置 › SF › 分店管理 新增分店。</Notice>
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
    </div>
  )
}
