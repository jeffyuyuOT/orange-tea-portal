import { useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { fmtMoney } from '../bkUtils'
import { deleteDividendEntry, deletePayout } from '../bkDividendData'
import { Notice } from '../bkUi'
import { DividendEntryForm, EventEditor, EventTable, NoteModal, StatCard } from './bonusParts'

const DETAIL_TITLES = {
  total: '金庫目前總額 — 明細',
  jeff_bank: 'Jeff B — 明細（入金 − Bank 收成 − Bank Cost）',
  mao_safe: 'Mao保 — 明細（入金 − Cash 收成 − Cash Cost）',
  other: '其他 — 明細（入金 − 其他 Cost）',
  cost: 'Cost — 明細',
}

// 金庫概況: the vault since the last 收成完全結算, the 入金 / cost behind it, and
// each party's 可領 / 已領 for the same window.
export default function VaultOverview({ view }) {
  const { combined: c, stores, storeId, storeNames, partyNames, data, reload, storesInView } = view
  const [detail, setDetail] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [note, setNote] = useState(null)
  const [error, setError] = useState('')

  const showStore = storesInView.length > 1
  const w = c.window
  const detailEvents = !detail
    ? []
    : c.windowEvents.filter((ev) => {
        if (detail === 'total') return true
        if (detail === 'cost') return ev.type === 'cost'
        if (ev.type === 'income') return ev.bucket === detail
        // Bank (payout or cost) comes out of Jeff B, Cash out of Mao保, a 其他 cost out of 其他
        if (ev.type === 'cost') return (detail === 'jeff_bank' && ev.method === 'bank') || (detail === 'mao_safe' && ev.method === 'cash') || (detail === 'other' && ev.method === 'other')
        return ev.type === 'payout' && ((detail === 'jeff_bank' && ev.method !== 'cash') || (detail === 'mao_safe' && ev.method === 'cash'))
      })

  const fullInfo = c.reports.filter((r) => r.lastFullDate).map((r) => ({ name: storeNames[r.storeId], date: r.lastFullDate }))
  const fullText =
    fullInfo.length === 0
      ? '尚無收成完全結算，從第一筆開始計算'
      : storesInView.length === 1
        ? `上一次收成完全結算：${fullInfo[0].date}`
        : `上一次收成完全結算：${fullInfo.map((f) => `${f.name} ${f.date}`).join('、')}`

  async function remove(ev) {
    try {
      if (ev.type === 'payout') await deletePayout(ev.id)
      else await deleteDividendEntry(ev.id)
      setEditing(null)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">{fullText}。點選下面的數字可以看明細。</p>
        <Button onClick={() => setAdding(true)} disabled={stores.length === 0}>
          ＋ 新增紀錄
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          <StatCard label="金庫目前總額" value={w.vault} onClick={() => setDetail('total')} hint="入金 − Cost − 已領取收成" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Jeff B" value={w.assets.jeff_bank} onClick={() => setDetail('jeff_bank')} hint="扣掉 Bank 收成和 Bank Cost" />
            <StatCard label="Mao保" value={w.assets.mao_safe} onClick={() => setDetail('mao_safe')} hint="扣掉 Cash 收成和 Cash Cost" />
            <StatCard label="其他" value={w.assets.other} onClick={() => setDetail('other')} hint="扣掉 其他 Cost" />
            <StatCard label="Cost" value={w.cost} tone="cost" onClick={() => setDetail('cost')} />
          </div>
        </div>

        <div className="rounded-xl border border-brand-100 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-brand-900">收成概況（上一次收成完全結算後）</div>
          {c.windowParties.length === 0 ? (
            <p className="text-sm text-gray-400">這個範圍還沒有設定 party。請到「設定」新增。</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {c.windowParties.map((p) => (
                <div key={p.key} className="rounded-lg bg-brand-50/60 px-3 py-2">
                  <div className="text-sm font-semibold text-brand-800">{p.name}</div>
                  <div className="mt-1 flex justify-between text-sm">
                    <span className="text-gray-500">可領收成</span>
                    <span className="tabular-nums">{fmtMoney(p.claimable)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">已領取收成</span>
                    <span className="tabular-nums">{fmtMoney(p.paid)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={DETAIL_TITLES[detail] ?? ''} wide footer={<Button onClick={() => setDetail(null)}>關閉</Button>}>
        <p className="mb-2 text-xs text-gray-500">
          {fullText}
          {storeId ? '' : '（全部分店）'}。
        </p>
        <EventTable
          events={[...detailEvents].reverse()}
          storeNames={storeNames}
          showStore={showStore}
          partyNames={partyNames}
          fullKeys={c.fullKeys}
          signed={detail === 'total' || detail === 'jeff_bank' || detail === 'mao_safe' || detail === 'other'}
          onNote={setNote}
          onOpen={(ev) => {
            setDetail(null)
            setEditing(ev)
          }}
        />
      </Modal>

      <Modal open={adding} onClose={() => setAdding(false)} title="新增紀錄">
        <DividendEntryForm
          stores={stores}
          storeId={storeId}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await reload()
          }}
        />
      </Modal>

      <EventEditor
        ev={editing}
        stores={stores}
        parties={data.parties}
        onClose={() => setEditing(null)}
        onChanged={async () => {
          setEditing(null)
          await reload()
        }}
        onDelete={remove}
      />
      <NoteModal note={note} onClose={() => setNote(null)} />
    </div>
  )
}
