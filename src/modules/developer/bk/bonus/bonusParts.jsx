import { useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { brisbaneTodayStr, fmtMoney, numToInput, toNum } from '../bkUtils'
import { BUCKET_LABELS, COST_METHOD_LABELS, METHOD_LABELS, payoutLabel } from '../bkDividend'
import { saveDividendEntry, savePayout } from '../bkDividendData'
import { Field, MoneyInput, NoteButton, Notice, inputCls } from '../bkUi'

export function StatCard({ label, value, onClick, tone = 'default', hint }) {
  const toneCls = tone === 'cost' ? 'text-red-600' : 'text-brand-900'
  const body = (
    <>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{fmtMoney(value)}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </>
  )
  const cls = 'rounded-xl border border-brand-100 bg-white px-4 py-3 text-left'
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition hover:border-brand-300 hover:bg-brand-50/50`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

// Delete confirmation with a warning mark.
export function ConfirmDelete({ open, text, onCancel, onConfirm }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="⚠️ 確定刪除？"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            確定刪除
          </Button>
        </>
      }
    >
      <p className="whitespace-pre-wrap text-sm text-gray-700">{text}</p>
      <p className="mt-2 text-xs text-red-600">刪除後無法復原，金庫和收成的數字會跟著重新計算。</p>
    </Modal>
  )
}

export function NoteModal({ note, onClose }) {
  return (
    <Modal open={note !== null} onClose={onClose} title="附註" footer={<Button onClick={onClose}>關閉</Button>}>
      <p className="whitespace-pre-wrap text-sm text-gray-700">{note}</p>
    </Modal>
  )
}

function StoreField({ stores, value, onChange, disabled }) {
  return (
    <Field label="分店">
      <select className={`${inputCls} w-full`} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Field>
  )
}

// 新增紀錄 on 金庫概況: 入金 (counted as 其他) or cost.
export function DividendEntryForm({ stores, storeId, initial = null, onSaved, onCancel, onDelete }) {
  const editing = !!initial?.id
  const [store, setStore] = useState(initial?.store ?? storeId ?? stores[0]?.id ?? '')
  const [kind, setKind] = useState(initial ? (initial.type === 'cost' ? 'cost' : 'income') : 'income')
  const [date, setDate] = useState(initial?.date ?? brisbaneTodayStr())
  const [amount, setAmount] = useState(initial ? numToInput(initial.amount) : '')
  const [costMethod, setCostMethod] = useState(initial?.method ?? 'bank')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    const n = toNum(amount)
    if (!store) return setError('請選擇分店。')
    if (!date) return setError('請輸入日期。')
    if (n === null || n <= 0) return setError('金額必須是大於 0 的數字。')
    try {
      await saveDividendEntry(store, { id: initial?.id, entry_date: date, kind, method: costMethod, amount: n, note })
      onSaved?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-3">
      {(!storeId || editing) && <StoreField stores={stores} value={store} onChange={setStore} disabled={editing} />}
      <Field label="類型">
        <select className={`${inputCls} w-full`} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="income">入金（歸類為「其他」）</option>
          <option value="cost">Cost</option>
        </select>
      </Field>
      {kind === 'cost' && (
        <Field label="方式" hint="Bank 從 Jeff B 扣，Cash 從 Mao保 扣，其他 從「其他」扣，金庫外 不動金庫、只在領取收成時扣">
          <select className={`${inputCls} w-full`} value={costMethod} onChange={(e) => setCostMethod(e.target.value)}>
            <option value="bank">Bank（從 Jeff B 扣）</option>
            <option value="cash">Cash（從 Mao保 扣）</option>
            <option value="other">其他（從「其他」扣）</option>
            <option value="outside">金庫外（不扣金庫，領取收成時才扣）</option>
          </select>
        </Field>
      )}
      <Field label="日期">
        <input type="date" className={`${inputCls} w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="金額">
        <MoneyInput value={amount} onChange={setAmount} allowNegative={false} className="!border-brand-200 !bg-white !text-left" />
      </Field>
      <Field label="附註（選填）">
        <textarea className={`${inputCls} w-full`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-between gap-2">
        <div>
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              刪除
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button onClick={submit}>提交</Button>
        </div>
      </div>
    </div>
  )
}

// 新增 / 編輯收成記錄.
export function PayoutForm({ stores, storeId, parties, initial = null, onSaved, onCancel, onDelete }) {
  const editing = !!initial?.id
  const [store, setStore] = useState(initial?.store ?? storeId ?? stores[0]?.id ?? '')
  const storeParties = parties.filter((p) => p.store_id === store)
  const [partyId, setPartyId] = useState(initial?.partyId ?? '')
  const [date, setDate] = useState(initial?.date ?? brisbaneTodayStr())
  const [amount, setAmount] = useState(initial ? numToInput(initial.amount) : '')
  const [method, setMethod] = useState(initial?.method ?? 'bank')
  const [settle, setSettle] = useState(!!initial?.settle)
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

  const activeParty = storeParties.some((p) => p.id === partyId) ? partyId : storeParties[0]?.id ?? ''

  async function submit() {
    setError('')
    const n = toNum(amount)
    if (!store) return setError('請選擇分店。')
    if (!activeParty) return setError('這間分店還沒有 party，請先到「設定」新增。')
    if (!date) return setError('請輸入日期。')
    if (n === null || n <= 0) return setError('金額必須是大於 0 的數字。')
    try {
      await savePayout(store, { id: initial?.id, party_id: activeParty, entry_date: date, amount: n, method, is_settlement: settle, note })
      onSaved?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-3">
      {(!storeId || editing) && <StoreField stores={stores} value={store} onChange={setStore} disabled={editing} />}
      <Field label="Party">
        <select className={`${inputCls} w-full`} value={activeParty} onChange={(e) => setPartyId(e.target.value)}>
          {storeParties.length === 0 && <option value="">（這間分店還沒有 party）</option>}
          {storeParties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="日期">
        <input type="date" className={`${inputCls} w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="金額">
        <MoneyInput value={amount} onChange={setAmount} allowNegative={false} className="!border-brand-200 !bg-white !text-left" />
      </Field>
      <Field label="方式">
        <select className={`${inputCls} w-full`} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
        </select>
      </Field>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={settle} onChange={(e) => setSettle(e.target.checked)} />
        <span>
          收成結算
          <span className="block text-xs text-gray-400">勾選後，如果這筆之後金庫總額剛好歸零，會顯示為「收成完全結算」，金庫從下一筆重新計算。</span>
        </span>
      </label>
      <Field label="附註（選填）">
        <textarea className={`${inputCls} w-full`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-between gap-2">
        <div>
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              刪除
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button onClick={submit}>提交</Button>
        </div>
      </div>
    </div>
  )
}

// A list of events. `signed` shows payouts / cost as negative (vault detail).
// Rows of 收成頁 data are clickable to edit; U帳 入金 rows are read-only.
export function EventTable({ events, storeNames, showStore, partyNames, fullKeys, signed = false, onOpen, onNote }) {
  if (events.length === 0) return <p className="py-6 text-center text-sm text-gray-400">沒有紀錄。</p>
  const describe = (ev) => {
    if (ev.type === 'income') return `入金 · ${BUCKET_LABELS[ev.bucket] ?? ev.bucket}${ev.source === 'ucash' ? '（U帳）' : ''}`
    if (ev.type === 'cost') return `Cost · ${COST_METHOD_LABELS[ev.method] ?? '（未選方式）'}`
    return `收成 · ${partyNames[ev.partyId] ?? '（已刪除的 party）'} · ${METHOD_LABELS[ev.method] ?? ev.method}`
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-brand-100">
      <table className="min-w-full text-sm">
        <thead className="bg-brand-100 text-left text-xs text-gray-700">
          <tr>
            <th className="px-3 py-2">日期</th>
            {showStore && <th className="px-3 py-2">分店</th>}
            <th className="px-3 py-2">項目</th>
            <th className="px-3 py-2 text-right">金額</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => {
            const editable = ev.source !== 'ucash' && onOpen
            const label = ev.type === 'payout' ? payoutLabel(ev, fullKeys) : ''
            // Payouts/cost show a manual "−" since their amount is stored
            // positive; a 入金 (income) row's amount carries its own sign
            // (a negative 入金 = withdrawal from the vault), so fmtMoney
            // already renders it with a "-" — just colour it red too.
            const negPrefix = signed && ev.type !== 'income'
            const neg = negPrefix || (ev.type === 'income' && ev.amount < 0)
            return (
              <tr
                key={ev.key}
                onClick={editable ? () => onOpen(ev) : undefined}
                className={`border-t border-gray-100 ${editable ? 'cursor-pointer hover:bg-brand-50/60' : ''}`}
              >
                <td className="whitespace-nowrap px-3 py-2">{ev.date}</td>
                {showStore && <td className="whitespace-nowrap px-3 py-2">{storeNames[ev.store] ?? ''}</td>}
                <td className="px-3 py-2">
                  {describe(ev)}
                  {label && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${label === '收成完全結算' ? 'bg-green-100 text-green-700' : 'bg-brand-100 text-brand-700'}`}>
                      {label}
                    </span>
                  )}
                  <span onClick={(e) => e.stopPropagation()}>
                    <NoteButton note={ev.note} onOpen={onNote} />
                  </span>
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${neg ? 'text-red-600' : ''}`}>
                  {negPrefix ? '−' : ''}
                  {fmtMoney(ev.amount)}
                </td>
                <td className="px-3 py-2 text-right text-xs text-brand-500">{editable ? '編輯' : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Edit / delete modals for an event opened from any list.
export function EventEditor({ ev, stores, parties, onClose, onChanged, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  if (!ev) return null
  const isPayout = ev.type === 'payout'
  return (
    <>
      <Modal open={!confirming} onClose={onClose} title={isPayout ? '編輯收成記錄' : ev.type === 'cost' ? '編輯 Cost' : '編輯入金'}>
        {isPayout ? (
          <PayoutForm
            stores={stores}
            storeId={ev.store}
            parties={parties}
            initial={ev}
            onCancel={onClose}
            onSaved={onChanged}
            onDelete={() => setConfirming(true)}
          />
        ) : (
          <DividendEntryForm
            stores={stores}
            storeId={ev.store}
            initial={ev}
            onCancel={onClose}
            onSaved={onChanged}
            onDelete={() => setConfirming(true)}
          />
        )}
      </Modal>
      <ConfirmDelete
        open={confirming}
        text={`${ev.date}　${isPayout ? '收成' : ev.type === 'cost' ? 'Cost' : '入金'}　${fmtMoney(ev.amount)}`}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          await onDelete(ev)
          setConfirming(false)
        }}
      />
    </>
  )
}
