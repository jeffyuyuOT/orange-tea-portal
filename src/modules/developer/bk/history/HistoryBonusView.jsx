import { useCallback, useEffect, useMemo, useState } from 'react'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { combineReports, storeReport } from '../bkDividend'
import { loadDividendData } from '../bkDividendData'
import { Notice, StoreTabs } from '../bkUi'
import BonusHistory from '../bonus/BonusHistory'

// 歷史紀錄 > 收成. Builds the same `view` shape BonusTab computes for its own
// 金庫概況/收成記錄 sub-tabs, but independently — 歷史紀錄 is its own
// top-level tab now, not a sub-tab of 收成, so it reads 收成's data itself
// rather than sharing BonusTab's component state.
export default function HistoryBonusView({ stores, active }) {
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

  useEffect(() => {
    if (active) reload()
  }, [active, reload])

  const view = useMemo(() => {
    if (!data) return null
    const storesInView = storeId ? stores.filter((s) => s.id === storeId) : stores
    const reports = storesInView.map((s) => storeReport(s.id, data, data.parties.filter((p) => p.store_id === s.id)))
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
    return <Notice kind="info">還沒有任何分店。請先到 系統設置 › 消費展望 › 分店管理 新增分店。</Notice>
  }

  return (
    <div className="space-y-4">
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} allowAll />
      {!data ? <LoadingSpinner /> : view && <BonusHistory view={view} />}
    </div>
  )
}
