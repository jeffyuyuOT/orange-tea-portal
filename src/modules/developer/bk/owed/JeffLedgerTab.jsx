import { useCallback, useEffect, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../../components/ui/LoadingSpinner'
import { deleteJeffOwedEntry, loadJeffOwedEntries, loadJeffPayrollSalary, saveJeffOwedEntry } from '../bkData'
import { brisbaneTodayStr, fmtMoney, round2, toNum } from '../bkUtils'
import { Field, MoneyInput, NoteButton, Notice, StoreTabs, inputCls } from '../bkUi'

const KINDS = [
  ['salary', '薪水'],
  ['advance_pay', '預付'],
  ['advance_draw', '預拿'],
]
const KIND_LABEL = Object.fromEntries(KINDS)

// 積欠 > Jeff: 薪水 / 預付 / 預拿, each its own column with its own Total, plus
// an overall balance (薪水 + 預付 − 預拿). 薪水 merges manually typed rows with
// whatever payroll already computed for Jeff (bk_jeff_payroll_salary — read
// live, never copied in) — payroll rows show their pay period and can't be
// edited/deleted here; 加入 goes back to the payroll app for that.
//
// Jeff, 2026-10-21 (point 2): "BK的積欠Jeff下要可以切換分店(分店資料跟隨U帳
// 分店)，目前的系統裡的資料是屬於sunnybank下" — manual entries now carry a
// store_id (migration 0130_bk_owed_jeff_per_store.sql; every pre-existing row
// backfilled to Sunnybank). bk_jeff_payroll_salary() itself stays a single
// company-wide total (never split by store), so per Jeff's own answer when
// asked how to handle it post-switch ("只在sunnybank顯示") those 薪水 rows —
// and their contribution to salaryTotal — only show while Sunnybank is the
// selected store, nowhere else.
export default function JeffLedgerTab({ stores, topActive = true }) {
  const sunnybank = stores.find((s) => s.name === 'Sunnybank')
  const [storeId, setStoreId] = useState(() => sunnybank?.id ?? stores[0]?.id ?? null)
  const [manual, setManual] = useState([])
  const [payroll, setPayroll] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [note, setNote] = useState(null)

  const isSunnybank = storeId === sunnybank?.id

  const reload = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    setError('')
    try {
      const [m, p] = await Promise.all([loadJeffOwedEntries(storeId), loadJeffPayrollSalary()])
      setManual(m)
      setPayroll(p)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => {
    if (topActive) reload()
  }, [topActive, reload])

  async function remove(entry) {
    if (!window.confirm(`確定刪除這筆「${KIND_LABEL[entry.kind]}」紀錄？\n${entry.entry_date} ${fmtMoney(Number(entry.amount))}`)) return
    try {
      await deleteJeffOwedEntry(entry.id)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const salaryManual = manual.filter((e) => e.kind === 'salary')
  const advancePay = manual.filter((e) => e.kind === 'advance_pay')
  const advanceDraw = manual.filter((e) => e.kind === 'advance_draw')
  const visiblePayroll = isSunnybank ? payroll : []

  const salaryTotal = round2(
    visiblePayroll.reduce((a, p) => a + Number(p.amount), 0) + salaryManual.reduce((a, e) => a + Number(e.amount), 0)
  )
  const payTotal = round2(advancePay.reduce((a, e) => a + Number(e.amount), 0))
  const drawTotal = round2(advanceDraw.reduce((a, e) => a + Number(e.amount), 0))
  const balance = round2(salaryTotal + payTotal - drawTotal)

  if (loading && manual.length === 0 && payroll.length === 0) return <LoadingSpinner />

  return (
    <div className="space-y-4">
      <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm">
          Balance（薪水 + 預付 − 預拿）：
          <span className="ml-1 text-lg font-semibold tabular-nums text-brand-900">{fmtMoney(balance)}</span>
        </div>
        <Button onClick={() => setAdding(true)}>＋ 新增</Button>
      </div>

      {error && (
        <Notice kind="error" onClose={() => setError('')}>
          {error}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <OwedColumn
          title="薪水"
          total={salaryTotal}
          empty="還沒有薪水紀錄。"
          rows={[
            ...visiblePayroll.map((p) => ({
              key: `p-${p.sheet_id}`,
              date: p.date_to,
              label: `${p.date_from} 到 ${p.date_to}`,
              amount: Number(p.amount),
              tag: 'payroll',
            })),
            ...salaryManual.map((e) => ({
              key: `m-${e.id}`,
              date: e.entry_date,
              label: e.description || e.entry_date,
              amount: Number(e.amount),
              note: e.note,
              onEdit: () => setEditing(e),
              onDelete: () => remove(e),
            })),
          ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))}
          onNote={setNote}
        />
        <OwedColumn
          title="預付"
          total={payTotal}
          empty="還沒有預付紀錄。"
          rows={advancePay
            .map((e) => ({
              key: e.id,
              date: e.entry_date,
              label: e.description,
              amount: Number(e.amount),
              note: e.note,
              onEdit: () => setEditing(e),
              onDelete: () => remove(e),
            }))
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))}
          onNote={setNote}
        />
        <OwedColumn
          title="預拿"
          total={drawTotal}
          empty="還沒有預拿紀錄。"
          rows={advanceDraw
            .map((e) => ({
              key: e.id,
              date: e.entry_date,
              label: e.description,
              amount: Number(e.amount),
              note: e.note,
              onEdit: () => setEditing(e),
              onDelete: () => remove(e),
            }))
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))}
          onNote={setNote}
        />
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="新增">
        <JeffEntryForm storeId={storeId} onCancel={() => setAdding(false)} onSaved={async () => { setAdding(false); await reload() }} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="編輯">
        {editing && (
          <JeffEntryForm
            initial={editing}
            storeId={storeId}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null)
              await reload()
            }}
          />
        )}
      </Modal>
      <Modal open={note !== null} onClose={() => setNote(null)} title="附註" footer={<Button onClick={() => setNote(null)}>關閉</Button>}>
        <p className="whitespace-pre-wrap text-sm text-gray-700">{note}</p>
      </Modal>
    </div>
  )
}

function OwedColumn({ title, total, rows, empty, onNote }) {
  return (
    <div className="overflow-hidden rounded-xl border border-brand-100">
      <div className="flex items-center justify-between bg-brand-50 px-3 py-2">
        <span className="text-sm font-semibold text-brand-900">{title}</span>
        <span className="text-sm font-semibold tabular-nums text-brand-900">{fmtMoney(total)}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-6">
          <EmptyState label={empty} />
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="whitespace-nowrap text-xs text-gray-500">{r.tag === 'payroll' ? r.label : r.date}</div>
                <div className="truncate">
                  {r.tag === 'payroll' ? (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">來自 payroll</span>
                  ) : (
                    <>
                      {r.label}
                      <NoteButton note={r.note} onOpen={onNote} />
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="tabular-nums">{fmtMoney(r.amount)}</span>
                {r.onEdit && (
                  <div className="flex gap-1">
                    <button type="button" onClick={r.onEdit} className="text-xs text-brand-600 hover:underline">
                      編輯
                    </button>
                    <button type="button" onClick={r.onDelete} className="text-xs text-red-600 hover:underline">
                      刪除
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function JeffEntryForm({ initial = null, storeId, onSaved, onCancel }) {
  const [kind, setKind] = useState(initial?.kind ?? 'salary')
  const [date, setDate] = useState(initial?.entry_date ?? brisbaneTodayStr())
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    const n = toNum(amount)
    if (!date) return setError('請輸入日期。')
    if (!description.trim()) return setError('請輸入 description。')
    if (n === null || n <= 0) return setError('請輸入金額（必須大於 0）。')
    try {
      await saveJeffOwedEntry({ id: initial?.id, kind, entry_date: date, description, amount: n, note, storeId })
      onSaved?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-3">
      <Field label="類型">
        <select className={`${inputCls} w-full`} value={kind} disabled={!!initial} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="日期">
        <input type="date" className={`${inputCls} w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Description">
        <input className={`${inputCls} w-full`} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="金額">
        <MoneyInput value={amount} onChange={setAmount} allowNegative={false} className="!border-brand-200 !bg-white !text-left" />
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
