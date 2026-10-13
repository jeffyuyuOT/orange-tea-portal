import { useCallback, useEffect, useMemo, useState } from 'react'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { combineReports, storeReport } from '../bkDividend'
import { loadDividendData } from '../bkDividendData'
import { Notice, StoreTabs, SubTabs } from '../bkUi'
import PayoutPanel from './PayoutPanel'
import VaultOverview from './VaultOverview'

const SUBTABS = [
  ['vault', '金庫概況'],
  ['payout', '收成記錄'],
]

// 收成: 金庫概況 | 收成記錄. 歷史紀錄 moved to the top-level 歷史紀錄 tab
// (history/HistoryBonusView.jsx) and 設定 (party 設置) moved to 系統設置
// (settings/SettingsTab.jsx) — both still read/write the same bk_* tables via
// bkDividendData.js, just from a different page. The store filter (or
// 全部分店) is shared by the two sub-tabs left here.
export default function BonusTab({ stores, topActive = true }) {
  const [sub, setSub] = useState('vault')
  const [storeId, setStoreId] = useState(null) // null = 全部分店
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

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
    return <Notice kind="info">還沒有任何分店。請先到 系統設置 › SF › 分店管理 新增分店。</Notice>
  }

  return (
    <div className="space-y-4">
      <SubTabs tabs={SUBTABS} value={sub} onChange={setSub} />
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {!data && !error && <LoadingSpinner />}
      {data && view && (
        <>
          <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} allowAll />
          {sub === 'vault' && <VaultOverview view={view} />}
          {sub === 'payout' && <PayoutPanel view={view} />}
        </>
      )}
    </div>
  )
}
