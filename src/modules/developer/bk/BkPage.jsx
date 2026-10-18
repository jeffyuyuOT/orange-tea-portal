import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import { loadStores } from './bkData'
import { loadSalesStores } from './bkSalesData'
import { Notice } from './bkUi'
const SalesFigureTab = lazy(() => import('./sales/SalesFigureTab'))
const BizTab = lazy(() => import('./biz/BizTab'))
const HoursTab = lazy(() => import('./hours/HoursTab'))
const UAccountTab = lazy(() => import('./ucash/UAccountTab'))
const BonusTab = lazy(() => import('./bonus/BonusTab'))
const OwedPage = lazy(() => import('./owed/OwedPage'))
const HistoryTab = lazy(() => import('./history/HistoryTab'))
const SettingsTab = lazy(() => import('./settings/SettingsTab'))
import BackupGuard from './BackupGuard'

// BK (記帳) — developer-only bookkeeping page. Gated by RequirePage on
// developer_tools.bk (routes.jsx), which only the developer role has; the real
// boundary is is_developer() RLS on the bk_* tables (migration 0101; the store list is bk_stores, 0102).
//
// 營業 (biz/) sits between Sales figure and U帳. It has its OWN store list
// (bk_sales_stores, migration 0111; managed in 系統設置 › 營業) — `salesStores`
// below — separate from `stores`, the SF / U帳 list. A 營業 store can be linked
// to an SF store: POS comes from that store's SF O.POST, and its Self O is the
// default for that store's SF Self order kiosk.
//
// Seven top tabs per the spec. Every tab stays mounted once opened (hidden,
// not unmounted) so switching top tabs never throws away unsaved typing.
//
// SF / U帳's own history sub-tabs moved into 歷史紀錄 (history/HistoryTab.jsx,
// re-using sales/SfHistory.jsx and ucash/UHistory.jsx unchanged); SF's 資料維護
// and 收成's 設定 moved into 系統設置 (settings/SettingsTab.jsx, re-using
// sales/SfMaintenance.jsx and bonus/PartySettings.jsx unchanged). Two bits of
// state used to live inside the tab that moved, and now have to be lifted up
// here so the pieces still talk to each other across tabs:
//   - typesVersion: bumped by 系統設置's SF payment-type editor, read by
//     SalesFigureTab's SfSheet so it re-reads its columns after a change made
//     from the other tab.
//   - sfJumpTarget / cashJumpTarget: set by 歷史紀錄's "載入" button (which
//     used to just switch a local sub-tab back to the sheet, now has to jump
//     to a different top-level tab AND tell it which store/month to open).
const TABS = [
  ['sf', 'Sales figure'],
  ['biz', '營業'],
  ['hours', '小時統計'],
  ['u', 'U帳'],
  ['bonus', '收成'],
  ['owed', '積欠'],
  ['history', '歷史紀錄'],
  ['settings', '系統設置'],
]

const TAB_NAMES = { sf: 'Sales figure', biz: '營業', u: 'U帳' }

export default function BkPage() {
  const [tab, setTab] = useState('sf')
  const [visited, setVisited] = useState(() => new Set(['sf']))
  const [stores, setStores] = useState(null)
  const [salesStores, setSalesStores] = useState(null)
  const [error, setError] = useState('')
  const [typesVersion, setTypesVersion] = useState(0)
  const [sfJumpTarget, setSfJumpTarget] = useState(null)
  const [cashJumpTarget, setCashJumpTarget] = useState(null)

  // 儲存 (next to the title): every tab with typing in it reports "dirty" here
  // and hands over its own save function, so one click saves them all.
  //   sf   → saves the open month as a draft (not submitted)
  //   biz  → 營業's store sheet and 手動輸入總頁
  //   u    → 分店現金
  const savers = useRef({})
  const [dirtyTabs, setDirtyTabs] = useState({})
  const [saveAllBusy, setSaveAllBusy] = useState(false)
  const [saveAllMsg, setSaveAllMsg] = useState(null) // { kind, text }
  const registerSaver = useCallback((key, fn) => {
    if (fn) savers.current[key] = fn
    else delete savers.current[key]
  }, [])
  const setTabDirty = useCallback((key, d) => {
    setDirtyTabs((prev) => (!!prev[key] === !!d ? prev : { ...prev, [key]: !!d }))
  }, [])
  const onSfDirty = useCallback((d) => setTabDirty('sf', d), [setTabDirty])
  const onBizDirty = useCallback((d) => setTabDirty('biz', d), [setTabDirty])
  const onUDirty = useCallback((d) => setTabDirty('u', d), [setTabDirty])
  const dirtyKeys = Object.keys(dirtyTabs).filter((k) => dirtyTabs[k])

  async function saveAll() {
    setSaveAllBusy(true)
    setSaveAllMsg(null)
    const done = []
    const failed = []
    for (const key of dirtyKeys) {
      const fn = savers.current[key]
      if (!fn) continue
      try {
        if (await fn()) done.push(TAB_NAMES[key])
        else failed.push(TAB_NAMES[key])
      } catch {
        failed.push(TAB_NAMES[key])
      }
    }
    setSaveAllBusy(false)
    if (failed.length > 0) {
      setSaveAllMsg({ kind: 'error', text: `${failed.join('、')} 沒有儲存成功，請到該分頁查看原因。${done.length ? `已儲存：${done.join('、')}。` : ''}` })
    } else {
      setSaveAllMsg({ kind: 'ok', text: `已儲存：${done.join('、')}。` })
    }
  }
  useEffect(() => {
    if (saveAllMsg?.kind !== 'ok') return
    const t = setTimeout(() => setSaveAllMsg(null), 4000)
    return () => clearTimeout(t)
  }, [saveAllMsg])

  // Re-read BK's store list; called after 分店管理 adds / renames / deletes one.
  const reloadStores = useCallback(async () => {
    try {
      setStores(await loadStores())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // Re-read 營業's store list; called after 系統設置 › 營業 changes it.
  const reloadSalesStores = useCallback(async () => {
    try {
      setSalesStores(await loadSalesStores())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    reloadStores()
    reloadSalesStores()
  }, [reloadStores, reloadSalesStores])

  async function select(key) {
    // Leaving Sales figure with typing in it: keep it as a draft first, so the
    // other tabs (U帳's O.CA, …) see it without a 提交. Stay if that fails.
    if (tab === 'sf' && key !== 'sf' && dirtyTabs.sf && savers.current.sf) {
      if (!(await savers.current.sf())) return
    }
    setTab(key)
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }

  function loadSf(target) {
    setSfJumpTarget(target)
    select('sf')
  }
  function loadCash(target) {
    setCashJumpTarget(target)
    select('u')
  }

  return (
    <div className="font-zh mx-auto w-full max-w-[1600px] space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-brand-900">BK 記帳</h1>
        <Button onClick={saveAll} disabled={saveAllBusy || dirtyKeys.length === 0}>
          {saveAllBusy ? '儲存中…' : dirtyKeys.length ? `儲存（${dirtyKeys.map((k) => TAB_NAMES[k]).join('、')}）` : '儲存'}
        </Button>
        {saveAllMsg && (
          <span className={`text-sm ${saveAllMsg.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>{saveAllMsg.text}</span>
        )}
      </div>
      <BackupGuard />

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
      {(!stores || !salesStores) && !error && <LoadingSpinner />}

      {stores && salesStores && (
        <>
          {visited.has('sf') && (
            <div className={tab === 'sf' ? '' : 'hidden'}>
              <Suspense fallback={<LoadingSpinner />}>
              <SalesFigureTab
                stores={stores}
                salesStores={salesStores}
                topActive={tab === 'sf'}
                typesVersion={typesVersion}
                jumpTarget={sfJumpTarget}
                onJumpHandled={() => setSfJumpTarget(null)}
                onStoresChanged={reloadStores}
                onTabDirty={onSfDirty}
                registerSaver={registerSaver}
              />
            </Suspense>
            </div>
          )}
          {visited.has('biz') && (
            <div className={tab === 'biz' ? '' : 'hidden'}>
              <Suspense fallback={<LoadingSpinner />}>
              <BizTab stores={salesStores} topActive={tab === 'biz'} onTabDirty={onBizDirty} registerSaver={registerSaver} />
            </Suspense>
            </div>
          )}
          {visited.has('hours') && (
            <div className={tab === 'hours' ? '' : 'hidden'}>
              <Suspense fallback={<LoadingSpinner />}>
                <HoursTab stores={salesStores} topActive={tab === 'hours'} />
              </Suspense>
            </div>
          )}
          {visited.has('u') && (
            <div className={tab === 'u' ? '' : 'hidden'}>
              <Suspense fallback={<LoadingSpinner />}>
              <UAccountTab
                stores={stores}
                topActive={tab === 'u'}
                jumpTarget={cashJumpTarget}
                onJumpHandled={() => setCashJumpTarget(null)}
                onTabDirty={onUDirty}
                registerSaver={registerSaver}
              />
            </Suspense>
            </div>
          )}
          {visited.has('bonus') && (
            <div className={tab === 'bonus' ? '' : 'hidden'}>
              <Suspense fallback={<LoadingSpinner />}>
              <BonusTab stores={stores} topActive={tab === 'bonus'} />
            </Suspense>
            </div>
          )}
          {visited.has('owed') && (
            <div className={tab === 'owed' ? '' : 'hidden'}>
              <Suspense fallback={<LoadingSpinner />}>
              <OwedPage stores={stores} topActive={tab === 'owed'} />
            </Suspense>
            </div>
          )}
          {visited.has('history') && (
            <div className={tab === 'history' ? '' : 'hidden'}>
              <Suspense fallback={<LoadingSpinner />}>
              <HistoryTab
                stores={stores}
                salesStores={salesStores}
                topActive={tab === 'history'}
                onLoadSf={loadSf}
                onLoadCash={loadCash}
              />
            </Suspense>
            </div>
          )}
          {visited.has('settings') && (
            <div className={tab === 'settings' ? '' : 'hidden'}>
              <Suspense fallback={<LoadingSpinner />}>
              <SettingsTab
                stores={stores}
                salesStores={salesStores}
                onStoresChanged={reloadStores}
                onSalesStoresChanged={reloadSalesStores}
                onPaymentTypesChanged={() => setTypesVersion((v) => v + 1)}
              />
            </Suspense>
            </div>
          )}
        </>
      )}
    </div>
  )
}
