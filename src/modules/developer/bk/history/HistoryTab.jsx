import { useState } from 'react'
import { Notice, SubTabs } from '../bkUi'
import SfHistory from '../sales/SfHistory'
import UHistory from '../ucash/UHistory'
import HistoryBonusView from './HistoryBonusView'

const SUBTABS = [
  ['sf', 'SF'],
  ['u', 'U帳'],
  ['bonus', '收成'],
]

// 歷史紀錄 — SF / U帳 / 收成's history, each moved here from its own
// top-level tab so there's one place to look back at past months/records
// instead of three separate ones. "載入" in SF/U帳's history jumps back to
// that surface's own sheet via `onLoadSf`/`onLoadCash` — BkPage sets a jump
// target and switches the active top tab, since the sheet itself now lives
// on a different page than its history.
export default function HistoryTab({ stores, salesStores, topActive = true, onLoadSf, onLoadCash }) {
  const [sub, setSub] = useState('sf')

  if (stores.length === 0) {
    return <Notice kind="info">還沒有任何分店。請先到 系統設置 › SF › 分店管理 新增分店。</Notice>
  }

  return (
    <div className="space-y-4">
      <SubTabs tabs={SUBTABS} value={sub} onChange={setSub} />
      <div className={sub === 'sf' ? '' : 'hidden'}>
        <SfHistory stores={stores} salesStores={salesStores} sfStoreId={stores[0]?.id ?? null} active={topActive && sub === 'sf'} onLoad={onLoadSf} />
      </div>
      <div className={sub === 'u' ? '' : 'hidden'}>
        <UHistory stores={stores} storeId={stores[0]?.id ?? null} active={topActive && sub === 'u'} onLoad={onLoadCash} />
      </div>
      <div className={sub === 'bonus' ? '' : 'hidden'}>
        <HistoryBonusView stores={stores} active={topActive && sub === 'bonus'} />
      </div>
    </div>
  )
}
