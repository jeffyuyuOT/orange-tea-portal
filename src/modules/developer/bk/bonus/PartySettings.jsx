import { useEffect, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import { numToInput, round2, toNum } from '../bkUtils'
import { partySettingsProblem } from '../bkDividend'
import { savePartiesForStore } from '../bkDividendData'
import { MoneyInput, Notice, StoreTabs } from '../bkUi'

const toDraft = (parties) => parties.map((p) => ({ id: p.id, name: p.name, weight: numToInput(p.weight) }))

// 設定 > Party 設置: per store, the parties and their 加權 (must add up to 100%).
export default function PartySettings({ stores, data, reload, onDirtyChange }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const store = stores.find((s) => s.id === storeId) ?? stores[0]
  const existing = data.parties.filter((p) => p.store_id === store?.id)
  const signature = JSON.stringify(existing.map((p) => [p.id, p.name, Number(p.weight)]))

  const [draft, setDraft] = useState(() => toDraft(existing))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const nextKey = useRef(0)

  // Follow the database whenever there are no unsaved edits.
  useEffect(() => {
    if (!dirty) setDraft(toDraft(existing))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.id, signature])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  if (!store) return <Notice kind="info">還沒有任何分店。請先到 系統設置 › SF › 分店管理 新增分店。</Notice>

  const edit = (fn) => {
    setDraft(fn)
    setDirty(true)
    setSaved(false)
  }
  const total = round2(draft.reduce((a, p) => a + (toNum(p.weight) ?? 0), 0))
  const problem = partySettingsProblem(draft)
  const hasPayouts = (id) => data.payouts.some((p) => p.party_id === id) || data.manual.some((e) => e.party_id === id)

  function switchStore(id) {
    if (id === store.id) return
    if (dirty && !window.confirm('這間分店的 party 有未儲存的變更，確定要離開並捨棄嗎？')) return
    setDirty(false)
    setError('')
    setSaved(false)
    setStoreId(id)
  }

  function removeRow(i) {
    const row = draft[i]
    if (row.id && hasPayouts(row.id)) {
      setError(`「${row.name}」已有收成記錄，不能刪除。請先到收成記錄刪除那些紀錄。`)
      return
    }
    setError('')
    edit((d) => d.filter((_, j) => j !== i))
  }

  async function save() {
    setError('')
    if (problem) return setError(problem)
    try {
      await savePartiesForStore(store.id, draft, existing)
      setDirty(false)
      setSaved(true)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <StoreTabs stores={stores} storeId={store.id} onChange={switchStore} />
      <div className="max-w-xl space-y-3 rounded-xl border border-brand-100 bg-white p-4">
        <div className="text-sm font-semibold text-brand-900">Party 設置 — {store.name}</div>
        {saved && <Notice kind="ok" onClose={() => setSaved(false)}>已儲存。</Notice>}
        {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

        {draft.length === 0 ? (
          <p className="text-sm text-gray-400">這間分店還沒有 party。</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-2">名稱</th>
                <th className="py-1 pr-2 text-right">加權 (%)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.map((p, i) => (
                <tr key={p.id ?? p.tmp} className="border-t border-gray-100">
                  <td className="py-1.5 pr-2">
                    <input
                      className="w-full rounded border border-brand-200 bg-white px-2 py-1 text-sm focus:border-brand-400 focus:outline-none"
                      value={p.name}
                      onChange={(e) => edit((d) => d.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    />
                  </td>
                  <td className="w-28 py-1.5 pr-2">
                    <MoneyInput
                      value={p.weight}
                      allowNegative={false}
                      className="!border-brand-200 !bg-white"
                      onChange={(v) => edit((d) => d.map((r, j) => (j === i ? { ...r, weight: v } : r)))}
                    />
                  </td>
                  <td className="py-1.5 text-right">
                    <Button variant="danger" onClick={() => removeRow(i)}>
                      刪除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200">
                <td className="py-1.5 pr-2 text-xs text-gray-500">合計</td>
                <td className={`py-1.5 pr-3 text-right font-semibold tabular-nums ${Math.abs(total - 100) > 0.0005 ? 'text-red-600' : 'text-green-700'}`}>
                  {total}%
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        <div className="flex justify-between gap-2 pt-1">
          <Button
            variant="secondary"
            onClick={() => {
              nextKey.current += 1
              edit((d) => [...d, { tmp: `new-${nextKey.current}`, name: '', weight: '' }])
            }}
          >
            ＋ 新增 party
          </Button>
          <Button onClick={save} disabled={!dirty}>
            儲存
          </Button>
        </div>
        <p className="text-xs text-gray-400">所有 party 的加權加起來必須剛好是 100%。已經有收成記錄的 party 不能刪除。</p>
      </div>
    </div>
  )
}
