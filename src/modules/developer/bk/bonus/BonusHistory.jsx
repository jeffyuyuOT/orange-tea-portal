import { useMemo, useState } from 'react'
import { BUCKETS } from '../bkDividend'
import { deleteDividendEntry, deletePayout } from '../bkDividendData'
import { Notice, inputCls } from '../bkUi'
import { EventEditor, EventTable, NoteModal } from './bonusParts'
import { STATUS_LABELS, SettlementDetail } from './SettlementParts'
import { fmtMoney } from '../bkUtils'

const KINDS = [
  ['income', '入金紀錄'],
  ['payout', '收成紀錄'],
  ['cost', 'Cost 紀錄'],
  ['selfcost', 'Party自身支出紀錄'],
  ['settlement', '收成結算紀錄'],
]

// 歷史紀錄: every record (all time), by kind, filterable by date and store.
export default function BonusHistory({ view }) {
  const { combined: c, stores, storeId, storeNames, partyNames, data, reload, storesInView } = view
  const [kind, setKind] = useState('income')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [bucket, setBucket] = useState('')
  const [partyKey, setPartyKey] = useState('')
  const [method, setMethod] = useState('')
  const [editing, setEditing] = useState(null)
  const [note, setNote] = useState(null)
  const [error, setError] = useState('')
  const [openSettlement, setOpenSettlement] = useState(null)

  const partyOptions = c.allTimeParties
  const settlements = useMemo(
    () =>
      data.settlements
        .filter((s) => (storeId ? s.store_id === storeId : true))
        .filter((s) => (!from || s.settle_date >= from) && (!to || s.settle_date <= to))
        .sort((a, b) => (a.settle_date < b.settle_date ? 1 : a.settle_date > b.settle_date ? -1 : a.created_at < b.created_at ? 1 : -1)),
    [data.settlements, storeId, from, to]
  )
  const rows = useMemo(() => {
    const party = partyOptions.find((p) => p.key === partyKey)
    return c.events
      .filter((ev) => ev.type === kind)
      .filter((ev) => (!from || ev.date >= from) && (!to || ev.date <= to))
      .filter((ev) => kind !== 'income' || !bucket || ev.bucket === bucket)
      .filter((ev) => (kind !== 'payout' && kind !== 'selfcost') || !party || party.partyIds.includes(ev.partyId))
      .filter((ev) => kind !== 'payout' || !method || ev.method === method)
      .reverse()
  }, [c.events, kind, from, to, bucket, partyKey, method, partyOptions])

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
      <div className="flex gap-2">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${kind === k ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          從
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          到
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {kind === 'income' && (
          <select className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="入金方式">
            <option value="">全部入金方式</option>
            {BUCKETS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        )}
        {(kind === 'payout' || kind === 'selfcost') && (
          <>
            <select className={inputCls} value={partyKey} onChange={(e) => setPartyKey(e.target.value)} aria-label="Party">
              <option value="">全部 party</option>
              {partyOptions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
            {kind === 'payout' && (
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="方式">
                <option value="">全部方式</option>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
            )}
          </>
        )}
      </div>
      {kind === 'settlement' ? (
        <>
          <p className="text-xs text-gray-500">共 {settlements.length} 筆。收成結算只是結算參考，不會更動任何金庫和收成數據。點一筆看內容。</p>
          {settlements.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">沒有紀錄。</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-brand-100">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-100 text-left text-xs text-gray-700">
                  <tr>
                    <th className="px-3 py-2">日期</th>
                    <th className="px-3 py-2">分店</th>
                    <th className="px-3 py-2">狀態</th>
                    <th className="px-3 py-2">結算</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id} onClick={() => setOpenSettlement(s)} className="cursor-pointer border-t border-gray-100 hover:bg-brand-50/60">
                      <td className="whitespace-nowrap px-3 py-2">{s.settle_date}</td>
                      <td className="whitespace-nowrap px-3 py-2">{s.store_id ? storeNames[s.store_id] ?? '' : '全部分店'}</td>
                      <td className="px-3 py-2">{STATUS_LABELS[s.status]}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{s.rows.map((r) => `${r.name} ${fmtMoney(r.result)}`).join('　')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
      <>
      <p className="text-xs text-gray-500">共 {rows.length} 筆。分店用上面的分店標籤篩選。點一筆可以編輯（Stock lost 的入金要到 Stock lost 修改）。</p>
      <EventTable
        events={rows}
        storeNames={storeNames}
        showStore={storesInView.length > 1}
        partyNames={partyNames}
        fullKeys={c.fullKeys}
        onNote={setNote}
        onOpen={setEditing}
      />
      </>
      )}
      <SettlementDetail
        s={openSettlement}
        storeNames={storeNames}
        onClose={() => setOpenSettlement(null)}
        onChanged={async () => {
          setOpenSettlement(null)
          await reload()
        }}
      />
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
