import { useState } from 'react'
import { SubTabs } from '../bkUi'
import JeffLedgerTab from './JeffLedgerTab'
import EmmaBonusTab from './EmmaBonusTab'
import StoreDebtsTab from './StoreDebtsTab'

const SUB_TABS = [
  ['jeff', 'Jeff'],
  ['emma', 'Emma'],
  ['between', '分店之間'],
]

// 積欠: Jeff（薪水/預付/預拿） | Emma（Sunnybank 入金 10% bonus） | 分店之間
// （分店transfer 的借貸償還，見 bk_store_debts）. Each sub-tab stays mounted
// once opened, same "hidden not unmounted" pattern as the rest of BK.
export default function OwedPage({ stores, topActive = true }) {
  const [sub, setSub] = useState('jeff')
  const [visited, setVisited] = useState(() => new Set(['jeff']))

  function select(key) {
    setSub(key)
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }

  return (
    <div className="space-y-4">
      <SubTabs tabs={SUB_TABS} value={sub} onChange={select} />
      {visited.has('jeff') && (
        <div className={sub === 'jeff' ? '' : 'hidden'}>
          <JeffLedgerTab stores={stores} topActive={topActive && sub === 'jeff'} />
        </div>
      )}
      {visited.has('emma') && (
        <div className={sub === 'emma' ? '' : 'hidden'}>
          <EmmaBonusTab stores={stores} topActive={topActive && sub === 'emma'} />
        </div>
      )}
      {visited.has('between') && (
        <div className={sub === 'between' ? '' : 'hidden'}>
          <StoreDebtsTab stores={stores} topActive={topActive && sub === 'between'} />
        </div>
      )}
    </div>
  )
}
