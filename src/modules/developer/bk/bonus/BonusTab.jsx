import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { combineReports, storeReport } from '../bkDividend'
import { loadDividendData } from '../bkDividendData'
import { Notice, StoreTabs, SubTabs } from '../bkUi'
import BonusHistory from './BonusHistory'
import PartySettings from './PartySettings'
import PayoutPanel from './PayoutPanel'
import VaultOverview from './VaultOverview'

const SUBTABS = [
  ['vault', '金庫概況'],
  ['payout', '分紅記錄'],
  ['history', '歷史紀錄'],
  ['settings', '設定'],
]

// 分紅: 金庫概況 | 分紅記錄 | 歷史紀錄 | 設定. The store filter (or 全部分店) is
// shared by the first three; 設定 has its own per-store tabs and stays mounted
// so unsaved party edits aren't lost when switching sub-tabs.
export default function BonusTab({ stores, topActive = true }) {
  const [sub, setSub] = useState('vault')
  const [storeId, setStoreId] = useState(null) // null = 全部分店
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const settingsDirty = useRef(false)
  const onDirtyChange = useCallback((d) => {
    settingsDirty.current = d
  }, [])

  const reload = useCallback(async () => {
    try {
      setData(await loadDividendData())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // Read fresh data each time the tab is opened (U帳 入金 may have changed).
  useEffect(() => {
    if (topActive) reload()
  }, [topActive, reload])

  const view = useMemo(() => {
    if (!data) return null
    const storesInView = storeId ? stores.filter((s) => s.id === storeId) : stores
    const reports = storesInView.map((s) =>
      storeReport(s.id, data, data.parties.filter((p) => p.store_id === s.id))
    )
    return {
      stores,
      storeId,
      storesInView,
      data,
      reload,
      combined: combineReports(reports),
      storeNames: Object.fromEntries(stores.map((s) => [s.id, s.name])),
      partyNames: Object.fromEntries(data.parties.map((p) => [p.id, p.name])),
    }
  }, [data, stores, storeId, reload])

  if (stores.length === 0) {
    return <Notice kind="info">還沒有任何分店。請先到 Sales figure › 資料維護 › 分店管理 新增分店。</Notice>
  }

  return (
    <div className="space-y-4">
      <SubTabs tabs={SUBTABS} value={sub} onChange={setSub} />
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {!data && !error && <LoadingSpinner />}
      {data && view && (
        <>
          {sub !== 'settings' && <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} allowAll />}
          {sub === 'vault' && <VaultOverview view={view} />}
          {sub === 'payout' && <PayoutPanel view={view} />}
          {sub === 'history' && <BonusHistory view={view} />}
          <div className={sub === 'settings' ? '' : 'hidden'}>
            <PartySettings stores={stores} data={data} reload={reload} onDirtyChange={onDirtyChange} />
          </div>
        </>
      )}
    </div>
  )
}
