import { useState } from 'react'
import Button from '../../../../components/ui/Button'
import { saveEntry, saveStoreTransfer } from '../bkData'
import { brisbaneTodayStr, numToInput, toNum } from '../bkUtils'
import { Field, MoneyInput, Notice, inputCls } from '../bkUi'

// 新增收支 form. The first dropdown picks the group:
//   icost / ucost  -> date, description, amount (negative = income), note
//   other_income   -> date, description, amount (positive), note — raises that
//                     day's max D in 分店現金
//   dw             -> deposit or withdraw, date, amount, note
//   ruju (入金)    -> 入 Jeff bank / 入 Mao 保險箱, date, amount (negative =
//                     withdrawal from the vault), note
//   transfer       -> normal transfer or 借貸償還, from 分店, to 分店, date,
//                     amount (always positive), note (選填) — writes TWO
//                     Ucost rows (see bkData.saveStoreTransfer)
const GROUPS = [
  ['icost', 'Icost'],
  ['ucost', 'Ucost'],
  ['other_income', '其他收入'],
  ['dw', 'deposit / withdraw'],
  ['ruju', '入金'],
  ['transfer', '分店transfer'],
]

function groupOf(kind) {
  return kind === 'deposit' || kind === 'withdraw' ? 'dw' : kind
}

export default function EntryForm({ storeId, stores = [], initial = null, onSaved, onCancel }) {
  const editing = !!initial?.id
  const [group, setGroup] = useState(initial ? groupOf(initial.kind) : 'icost')
  const [dwKind, setDwKind] = useState(initial?.kind === 'withdraw' ? 'withdraw' : 'deposit')
  const [target, setTarget] = useState(initial?.ruju_target ?? 'jeff_bank')
  const [transferMode, setTransferMode] = useState('normal')
  const otherStore = stores.find((s) => s.id !== storeId) ?? stores[0]
  const [fromStoreId, setFromStoreId] = useState(storeId)
  const [toStoreId, setToStoreId] = useState(otherStore?.id ?? '')
  const [date, setDate] = useState(initial?.entry_date ?? brisbaneTodayStr())
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState(initial ? numToInput(initial.amount) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

  const isCost = group === 'icost' || group === 'ucost' // may be negative
  const isTransfer = group === 'transfer'
  const hasDescription = isCost || group === 'other_income'
  // 入金 may also go negative: it means a withdrawal from the vault, added
  // back into UCOH and deducted from the chosen 入金對象 in 金庫概覽.
  const allowNegativeAmount = isCost || group === 'ruju'

  async function submit() {
    setError('')
    const n = toNum(amount)
    if (!date) return setError('請輸入日期。')
    if (isTransfer) {
      if (!fromStoreId || !toStoreId) return setError('請選擇 from 和 to 分店。')
      if (fromStoreId === toStoreId) return setError('from 分店和 to 分店不能相同。')
    } else if (hasDescription && !description.trim()) {
      return setError('請輸入 description。')
    }
    if (n === null || n === 0) return setError('請輸入金額。')
    if (!allowNegativeAmount && n < 0) return setError('這個類型的金額必須是正數。')
    try {
      if (isTransfer) {
        await saveStoreTransfer({ fromStoreId, toStoreId, mode: transferMode, date, amount: n, note })
      } else {
        await saveEntry(storeId, {
          id: initial?.id,
          entry_date: date,
          kind: group === 'dw' ? dwKind : group,
          description: hasDescription ? description : null,
          amount: n,
          note,
          ruju_target: group === 'ruju' ? target : null,
        })
      }
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
      {isTransfer && (
        <>
          <div className="flex gap-4 text-sm">
            {[
              ['normal', 'Normal transfer'],
              ['loan_repay', '借貸償還'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="radio" name="transfer-mode" checked={transferMode === k} onChange={() => setTransferMode(k)} />
                {label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From 分店">
              <select className={`${inputCls} w-full`} value={fromStoreId ?? ''} onChange={(e) => setFromStoreId(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To 分店">
              <select className={`${inputCls} w-full`} value={toStoreId ?? ''} onChange={(e) => setToStoreId(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Notice kind="info">
            {transferMode === 'loan_repay'
              ? 'From 分店會記一筆借貸、To 分店會記一筆償還到「機件 › 分店之間」（兩邊各自累計，不互相沖銷）。'
              : '兩邊都記在 Ucost：From 分店為正數（UCOH 減少），To 分店為負數（UCOH 增加）。'}
          </Notice>
        </>
      )}

      <Field label="日期">
        <input type="date" className={`${inputCls} w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {hasDescription && (
        <Field label="Description">
          <input className={`${inputCls} w-full`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      )}
      <Field
        label="金額"
        hint={
          isCost
            ? '可以輸入負數，負數代表收入。'
            : group === 'other_income'
              ? '會加到當天「可耗損的最大金額」（O.CA + 其他收入）。'
              : group === 'ruju'
                ? '可以輸入負數，代表從金庫提取：金額會加回 UCOH，並依「入金對象」扣除金庫概覽裡的金額。'
                : isTransfer
                  ? '請輸入正數；方向由上面的 From / To 分店決定。'
                  : undefined
        }
      >
        <MoneyInput
          value={amount}
          onChange={setAmount}
          allowNegative={allowNegativeAmount}
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
