import { useState } from 'react'
import Button from '../../../../components/ui/Button'
import { saveEntry } from '../bkData'
import { brisbaneTodayStr, numToInput, toNum } from '../bkUtils'
import { Field, MoneyInput, Notice, inputCls } from '../bkUi'

// 新增收支 form. The first dropdown picks the group:
//   icost / ucost  -> date, description, amount (negative = income), note
//   dw             -> deposit or withdraw, date, amount, note
//   ruju (入金)    -> 入 Jeff bank / 入 Mao 保險箱, date, amount, note
const GROUPS = [
  ['icost', 'Icost'],
  ['ucost', 'Ucost'],
  ['dw', 'deposit / withdraw'],
  ['ruju', '入金'],
]

function groupOf(kind) {
  return kind === 'deposit' || kind === 'withdraw' ? 'dw' : kind
}

export default function EntryForm({ storeId, initial = null, onSaved, onCancel }) {
  const editing = !!initial?.id
  const [group, setGroup] = useState(initial ? groupOf(initial.kind) : 'icost')
  const [dwKind, setDwKind] = useState(initial?.kind === 'withdraw' ? 'withdraw' : 'deposit')
  const [target, setTarget] = useState(initial?.ruju_target ?? 'jeff_bank')
  const [date, setDate] = useState(initial?.entry_date ?? brisbaneTodayStr())
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState(initial ? numToInput(initial.amount) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

  const isCost = group === 'icost' || group === 'ucost'

  async function submit() {
    setError('')
    const n = toNum(amount)
    if (!date) return setError('請輸入日期。')
    if (isCost && !description.trim()) return setError('請輸入 description。')
    if (n === null || n === 0) return setError('請輸入金額。')
    if (!isCost && n < 0) return setError('這個類型的金額必須是正數。')
    try {
      await saveEntry(storeId, {
        id: initial?.id,
        entry_date: date,
        kind: group === 'dw' ? dwKind : group,
        description: isCost ? description : null,
        amount: n,
        note,
        ruju_target: group === 'ruju' ? target : null,
      })
      onSaved?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-3">
      <Field label="類型">
        <select className={`${inputCls} w-full`} value={group} disabled={editing} onChange={(e) => setGroup(e.target.value)}>
          {GROUPS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {group === 'dw' && (
        <div className="flex gap-4 text-sm">
          {['deposit', 'withdraw'].map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="radio" name="dw-kind" checked={dwKind === k} onChange={() => setDwKind(k)} />
              {k === 'deposit' ? 'Deposit' : 'Withdraw'}
            </label>
          ))}
        </div>
      )}
      {group === 'ruju' && (
        <Field label="入金對象">
          <select className={`${inputCls} w-full`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="jeff_bank">入 Jeff bank</option>
            <option value="mao_safe">入 Mao 保險箱</option>
            <option value="other">其他</option>
          </select>
        </Field>
      )}

      <Field label="日期">
        <input type="date" className={`${inputCls} w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {isCost && (
        <Field label="Description">
          <input className={`${inputCls} w-full`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      )}
      <Field label="金額" hint={isCost ? '可以輸入負數，負數代表收入。' : undefined}>
        <MoneyInput
          value={amount}
          onChange={setAmount}
          allowNegative={isCost}
          className="!border-brand-200 !bg-white !text-left"
        />
      </Field>
      <Field label="備註（選填）">
        <textarea className={`${inputCls} w-full`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button onClick={submit}>提交</Button>
      </div>
    </div>
  )
}
