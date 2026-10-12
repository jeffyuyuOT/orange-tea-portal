import { useCallback, useEffect, useState } from 'react'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import { loadStores } from './bkData'
import { Notice } from './bkUi'
import SalesFigureTab from './sales/SalesFigureTab'
import UAccountTab from './ucash/UAccountTab'

// BK (記帳) — developer-only bookkeeping page. Gated by RequirePage on
// developer_tools.bk (routes.jsx), which only the developer role has; the real
// boundary is is_developer() RLS on the bk_* tables (migration 0101; the store list is bk_stores, 0102).
//
// Five top tabs per the spec. Sales figure and U帳 are built; 分紅 / 積欠 /
// 系統設置 are still to be specced by Jeff and show a placeholder. Every tab
// stays mounted once opened (hidden, not unmounted) so switching top tabs
// never throws away unsaved typing.
const TABS = [
  ['sf', 'Sales figure'],
  ['u', 'U帳'],
  ['bonus', '分紅'],
  ['owed', '積欠'],
  ['settings', '系統設置'],
]

function ComingSoon({ name }) {
  return (
    <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-6 py-12 text-center text-sm text-gray-500">
      「{name}」的內容還沒有規格，等 Jeff 補上後再建置。
    </div>
  )
}

export default function BkPage() {
  const [tab, setTab] = useState('sf')
  const [visited, setVisited] = useState(() => new Set(['sf']))
  const [stores, setStores] = useState(null)
  const [error, setError] = useState('')

  // Re-read BK's store list; called after 分店管理 adds / renames / deletes one.
  const reloadStores = useCallback(async () => {
    try {
      setStores(await loadStores())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    reloadStores()
  }, [reloadStores])

  function select(key) {
    setTab(key)
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }

  return (
    <div className="font-zh mx-auto w-full max-w-[1600px] space-y-4 p-4">
      <h1 className="text-xl font-semibold text-brand-900">BK 記帳</h1>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-brand-50 p-1">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => select(key)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-800/70 hover:text-brand-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {!stores && !error && <LoadingSpinner />}

      {stores && (
        <>
          {visited.has('sf') && (
            <div className={tab === 'sf' ? '' : 'hidden'}>
              <SalesFigureTab stores={stores} topActive={tab === 'sf'} onStoresChanged={reloadStores} />
            </div>
          )}
          {visited.has('u') && (
            <div className={tab === 'u' ? '' : 'hidden'}>
              <UAccountTab stores={stores} topActive={tab === 'u'} />
            </div>
          )}
        </>
      )}
      {tab === 'bonus' && <ComingSoon name="分紅" />}
      {tab === 'owed' && <ComingSoon name="積欠" />}
      {tab === 'settings' && <ComingSoon name="系統設置" />}
    </div>
  )
}
