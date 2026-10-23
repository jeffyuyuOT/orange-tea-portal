import { useEffect, useMemo, useState } from 'react'
import LoadingSpinner, { EmptyState } from '../../../../components/ui/LoadingSpinner'
import { loadStoreDebts } from '../bkData'
import { fmtMoney, round2 } from '../bkUtils'
import { NoteButton, Notice, StoreTabs, inputCls } from '../bkUi'
import { NoteModal, StatCard } from '../bonus/bonusParts'

// 積欠 > 分店之間: every 分店transfer 借貸償還 writes the FROM store a 借貸 row
// and the TO store a 償還 row (bk_store_debts, migration 0109). Pick a store's
// own page (or 全部分店); 總積欠 and the record list can both be narrowed by
// 分店對象 and date, and 總積欠 recomputes from whatever is currently shown —
// it is this store's own 借貸總額 − 償還總額 under the active filters, not a
// pairwise balance against the other store (each store still only ever
// accumulates its own side in storage; this is just how it's displayed).
export default function StoreDebtsTab({ stores, topActive = true }) {
  const [storeId, setStoreId] = useState(null) // null = 全部分店
  const [peerId, setPeerId] = useState('') // '' = 全部
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)

  useEffect(() => {
    if (!topActive) return
    let cancelled = false
    setLoading(true)
    setError('')
    loadStoreDebts(storeId)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [storeId, topActive])

  const storeName = (id) => stores.find((s) => s.id === id)?.name ?? ''
  const showAll = !storeId

  const shown = useMemo(
    () => rows.filter((r) => (!peerId || r.peer_store_id === peerId) && (!from || r.entry_date >= from) && (!to || r.entry_date <= to)),
    [rows, peerId, from, to]
  )

  // 總積欠: borrow − repay under the active filters.
  const totalOwed = round2(shown.reduce((a, r) => a + (r.kind === 'borrow' ? Number(r.amount) : -Number(r.amount)), 0))

  return (
    <div className="space-y-4">
      <StoreTabs
        stores={stores}
        storeId={storeId}
        onChange={(id) => {
          setStoreId(id)
          setPeerId('')
        }}
        allowAll
      />

      <div className="flex flex-wrap items-center gap-3">
        <select className={inputCls} value={peerId} onChange={(e) => setPeerId(e.target.value)} aria-label="分店對象">
          <option value="">分店對象：全部</option>
          {stores
            .filter((s) => s.id !== storeId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          從
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          到
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {error && (
        <Notice kind="error" onClose={() => setError('')}>
          {error}
        </Notice>
      )}

      <StatCard
        label={showAll ? '總機件（全部分店）' : `${storeName(storeId)} — 總機件`}
        value={totalOwed}
        tone={totalOwed < 0 ? undefined : 'cost'}
        hint="借貸總額 − 償還總額（依目前篩選條件重新計算）"
      />

      {loading ? (
        <LoadingSpinner />
      ) : shown.length === 0 ? (
        <EmptyState label="還沒有符合條件的機件紀錄。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-100">
          <table className="min-w-full text-sm">
            <thead className="bg-brand-100 text-left text-xs text-gray-700">
              <tr>
                <th className="px-3 py-2">日期</th>
                {showAll && <th className="px-3 py-2">分店</th>}
                <th className="px-3 py-2">分店對象</th>
                <th className="px-3 py-2">種類</th>
                <th className="px-3 py-2 text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="whitespace-nowrap px-3 py-2">{r.entry_date}</td>
                  {showAll && <td className="px-3 py-2">{storeName(r.store_id)}</td>}
                  <td className="px-3 py-2">
                    {storeName(r.peer_store_id) || '（已刪除的分店）'}
                    <NoteButton note={r.note} onOpen={setNote} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={r.kind === 'borrow' ? 'font-medium text-red-600' : 'font-medium text-green-600'}>
                      {r.kind === 'borrow' ? '借貸' : '償還'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(Number(r.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NoteModal note={note} onClose={() => setNote(null)} />
    </div>
  )
}
