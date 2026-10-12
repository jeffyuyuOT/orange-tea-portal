import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import {
  RUJU_TARGET_LABELS,
  cashDaysFromRows,
  computeCashDay,
  computeCashSummary,
  dwSigned,
  fmtMoney,
  isWeekend,
  monthDates,
  numToInput,
  sfOcaMapFromRows,
  toggleStocked,
  weekdayOf,
} from '../bkUtils'
import { loadCashMonth, loadOpeningBalance, saveCashDays, saveOpeningBalance } from '../bkData'
import { exportCashXlsx } from '../bkExcel'
import { Field, MoneyInput, NoteButton, Notice, StoreTabs, YearMonthPicker, inputCls } from '../bkUi'
import EntryForm from './EntryForm'

const emptyCashDay = () => ({ actual_ca: '', d_amount: '', d_stocked: false })

function SummaryCard({ label, value, hint, tone = 'text-brand-900' }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-white px-4 py-3">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone}`}>{fmtMoney(value)}</div>
      {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
    </div>
  )
}

// A coloured side list (D/W, Icost, Ucost, 入金) with its own Total.
function Block({ title, tone, headers, rows, total, onNote }) {
  return (
    <div className={`overflow-hidden rounded-xl border ${tone.border}`}>
      <div className={`px-3 py-1.5 text-sm font-semibold ${tone.head}`}>{title}</div>
      <table className="w-full text-sm">
        <thead className="bg-white text-left text-gray-500">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-1.5 font-medium ${
                  i === headers.length - 1 ? 'whitespace-nowrap text-right' : i === 1 ? 'w-full' : 'whitespace-nowrap'
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-3 py-2 text-center text-gray-300">
                —
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={`px-3 py-1.5 ${
                    i === r.cells.length - 1
                      ? 'whitespace-nowrap text-right tabular-nums'
                      : i === 1
                        ? 'break-words'
                        : 'whitespace-nowrap'
                  }`}
                >
                  {c}
                  {i === r.cells.length - 1 && <NoteButton note={r.note} onOpen={onNote} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={`border-t font-semibold ${tone.foot}`}>
            <td className="px-3 py-1.5" colSpan={headers.length - 1}>
              Total
            </td>
            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtMoney(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const TONES = {
  dw: { border: 'border-sky-200', head: 'bg-sky-100 text-sky-900', foot: 'bg-sky-50 border-sky-200' },
  icost: { border: 'border-amber-200', head: 'bg-amber-100 text-amber-900', foot: 'bg-amber-50 border-amber-200' },
  ucost: { border: 'border-rose-200', head: 'bg-rose-100 text-rose-900', foot: 'bg-rose-50 border-rose-200' },
  ruju: { border: 'border-emerald-200', head: 'bg-emerald-100 text-emerald-900', foot: 'bg-emerald-50 border-emerald-200' },
}

// 分店現金: COH / UCOH / D / P/L for one store+month, the day-by-day table you
// type 實 CA and D into, and the month's 收支 lists beside it.
export default function StoreCashPanel({ stores, store, year, month, active, entriesVersion, onNavigate, onDirtyChange, onEntriesChanged }) {
  const [open, setOpen] = useState({ coh: 0, ucoh: 0 })
  const [sfMap, setSfMap] = useState({})
  const [cashDays, setCashDays] = useState({})
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [addOpen, setAddOpen] = useState(false)
  const [noteText, setNoteText] = useState(null)
  const [balanceForm, setBalanceForm] = useState(null)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Full load whenever the store / month changes.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setMsg('')
      try {
        const data = await loadCashMonth(store.id, year, month)
        if (cancelled) return
        setOpen(data.open)
        setSfMap(sfOcaMapFromRows(data.sfDays))
        setCashDays(cashDaysFromRows(data.cashDays))
        setEntries(data.entries)
        setDirty(false)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store.id, year, month, reloadKey])

  // Coming back to the tab / entries edited elsewhere: refresh the parts that
  // live outside this table (O.CA, opening balance, 收支) but keep what's typed.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadCashMonth(store.id, year, month)
      .then((data) => {
        if (cancelled) return
        setOpen(data.open)
        setSfMap(sfOcaMapFromRows(data.sfDays))
        setEntries(data.entries)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, entriesVersion, store.id, year, month])

  const dates = useMemo(() => monthDates(year, month), [year, month])
  const dayRows = useMemo(
    () => dates.map((date) => ({ date, ...computeCashDay(sfMap[date], cashDays[date]) })),
    [dates, sfMap, cashDays]
  )
  const summary = useMemo(() => computeCashSummary(open.coh, open.ucoh, dayRows, entries), [open, dayRows, entries])

  function setField(date, field, value) {
    setCashDays((prev) => ({ ...prev, [date]: { ...emptyCashDay(), ...prev[date], [field]: value } }))
    setDirty(true)
    setMsg('')
  }
  function onStockToggle(date, checked) {
    setCashDays((prev) => {
      const current = Object.fromEntries(dates.map((d) => [d, !!prev[d]?.d_stocked]))
      const next = toggleStocked(dates, current, date, checked)
      const out = { ...prev }
      for (const d of dates) {
        if (next[d] !== current[d]) out[d] = { ...emptyCashDay(), ...prev[d], d_stocked: next[d] }
      }
      return out
    })
    setDirty(true)
    setMsg('')
  }

  async function save() {
    setSaving(true)
    setError('')
    setMsg('')
    try {
      await saveCashDays(store.id, cashDays)
      setDirty(false)
      setMsg('已儲存。')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function doExport() {
    try {
      await exportCashXlsx({ storeName: store.name, year, month, open, sfDaysMap: sfMap, cashDaysMap: cashDays, entries })
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    }
  }

  async function openBalance() {
    setError('')
    try {
      const ob = await loadOpeningBalance(store.id)
      setBalanceForm({
        month: ob ? ob.start_month.slice(0, 7) : `${year}-${String(month).padStart(2, '0')}`,
        coh: ob ? numToInput(ob.coh) : '0',
        ucoh: ob ? numToInput(ob.ucoh) : '0',
        error: '',
      })
    } catch (e) {
      setError(e.message)
    }
  }
  async function saveBalance() {
    if (!/^\d{4}-\d{2}$/.test(balanceForm.month)) return setBalanceForm({ ...balanceForm, error: '請選擇開始月份。' })
    try {
      await saveOpeningBalance(store.id, { startMonth: `${balanceForm.month}-01`, coh: balanceForm.coh, ucoh: balanceForm.ucoh })
      setBalanceForm(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setBalanceForm({ ...balanceForm, error: e.message })
    }
  }

  const byKind = (...kinds) => entries.filter((e) => kinds.includes(e.kind))
  const th = 'border border-brand-100 px-2 py-1.5 text-xs font-semibold text-gray-700'
  const td = 'border border-gray-100 p-0'

  return (
    <div className="space-y-3">
      <StoreTabs stores={stores} storeId={store.id} onChange={(id) => onNavigate({ storeId: id })} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-brand-900">{store.name}</span>
        <YearMonthPicker year={year} month={month} onChange={(v) => onNavigate(v)} />
        {dirty && <span className="text-xs font-medium text-brand-600">有未儲存的變更</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={openBalance}>
            期初餘額
          </Button>
          <Button variant="secondary" onClick={doExport} disabled={dirty || loading} title={dirty ? '請先儲存再匯出' : ''}>
            匯出
          </Button>
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            ＋ 新增收支
          </Button>
          <Button onClick={save} disabled={saving || loading || !dirty}>
            儲存
          </Button>
        </div>
      </div>

      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="COH（SF 現金）" value={summary.coh} hint={`上月月底 ${fmtMoney(open.coh)}`} />
            <SummaryCard label="UCOH（非 SF 現金）" value={summary.ucoh} hint={`上月月底 ${fmtMoney(open.ucoh)}`} />
            <SummaryCard label="D（未入庫）" value={summary.dUnstocked} />
            <SummaryCard label="P/L" value={summary.pl} tone={summary.pl < 0 ? 'text-red-600' : 'text-green-700'} />
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <div className="max-h-[70vh] flex-none overflow-auto rounded-xl border border-brand-100">
              {/* Fixed widths: an <input> otherwise stretches its column to its
                  own default width, which made 實 CA and D far wider than O.CA
                  and squeezed the side lists. O.CA, 實 CA and D share one width. */}
              <table className="table-fixed border-collapse text-sm" style={{ width: 640 }}>
                <colgroup>
                  <col style={{ width: 92 }} />
                  <col style={{ width: 104 }} />
                  <col style={{ width: 104 }} />
                  <col style={{ width: 84 }} />
                  <col style={{ width: 104 }} />
                  <col style={{ width: 48 }} />
                  <col style={{ width: 104 }} />
                </colgroup>
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th className={`${th} sticky left-0 z-30 bg-brand-100 text-left`}>日期</th>
                    <th className={`${th} bg-green-50`}>O.CA</th>
                    <th className={`${th} bg-brand-100`}>實 CA</th>
                    <th className={`${th} bg-gray-100`}>+/−</th>
                    <th className={`${th} bg-sky-50`}>D</th>
                    <th className={`${th} bg-sky-50`}>入庫</th>
                    <th className={`${th} bg-brand-100`}>SF cash</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((r) => {
                    const bg = isWeekend(r.date) ? 'bg-gray-50' : 'bg-white'
                    const cd = cashDays[r.date] ?? emptyCashDay()
                    return (
                      <tr key={r.date} className={bg}>
                        <td className={`${td} sticky left-0 z-10 whitespace-nowrap px-2 py-1 ${bg}`}>
                          <span className="font-medium">{Number(r.date.slice(8))}</span>{' '}
                          <span className="text-xs text-gray-400">{weekdayOf(r.date)}</span>
                        </td>
                        <td className={`${td} px-2 py-1 text-right tabular-nums text-gray-600`} title="與 SF 頁面同步">
                          {fmtMoney(r.oCa)}
                        </td>
                        <td className={td}>
                          <MoneyInput value={cd.actual_ca} onChange={(v) => setField(r.date, 'actual_ca', v)} />
                        </td>
                        <td
                          className={`${td} px-2 py-1 text-right tabular-nums ${
                            r.pm === null ? '' : r.pm < 0 ? 'text-red-600' : r.pm > 0 ? 'text-green-700' : ''
                          }`}
                        >
                          {fmtMoney(r.pm)}
                        </td>
                        <td className={td}>
                          <MoneyInput value={cd.d_amount} onChange={(v) => setField(r.date, 'd_amount', v)} />
                        </td>
                        <td className={`${td} text-center`}>
                          <input
                            type="checkbox"
                            checked={!!cd.d_stocked}
                            onChange={(e) => onStockToggle(r.date, e.target.checked)}
                            title="勾選後，這天以前的日期也會自動勾選"
                          />
                        </td>
                        <td className={`${td} px-2 py-1 text-right tabular-nums text-gray-700`} title="O.CA − D">
                          {fmtMoney(r.sfCash)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-20">
                  <tr className="bg-brand-50 font-semibold">
                    <td className={`${td} sticky left-0 z-30 bg-brand-50 px-2 py-1.5`}>Total</td>
                    <td className={`${td} px-2 py-1.5 text-right tabular-nums`}>{fmtMoney(summary.totals.oCa)}</td>
                    <td className={`${td} px-2 py-1.5 text-right tabular-nums`}>{fmtMoney(summary.totals.actual)}</td>
                    <td className={`${td} px-2 py-1.5 text-right tabular-nums`}>{fmtMoney(summary.totals.pm)}</td>
                    <td className={`${td} px-2 py-1.5 text-right tabular-nums`}>{fmtMoney(summary.totals.d)}</td>
                    <td className={td} />
                    <td className={`${td} px-2 py-1.5 text-right tabular-nums`}>{fmtMoney(summary.totals.sfCash)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="grid min-w-0 flex-1 gap-4">
              <Block
                title="D/W"
                tone={TONES.dw}
                headers={['日期', '類型', '金額']}
                total={summary.entryTotals.dw}
                onNote={setNoteText}
                rows={byKind('deposit', 'withdraw').map((e) => ({
                  id: e.id,
                  note: e.note,
                  cells: [e.entry_date.slice(5), e.kind === 'deposit' ? 'Deposit' : 'Withdraw', fmtMoney(dwSigned(e))],
                }))}
              />
              <Block
                title="入金"
                tone={TONES.ruju}
                headers={['日期', '類型', '金額']}
                total={summary.entryTotals.ruju}
                onNote={setNoteText}
                rows={byKind('ruju').map((e) => ({
                  id: e.id,
                  note: e.note,
                  cells: [e.entry_date.slice(5), RUJU_TARGET_LABELS[e.ruju_target], fmtMoney(Number(e.amount))],
                }))}
              />
              <Block
                title="Icost"
                tone={TONES.icost}
                headers={['日期', 'Description', '金額']}
                total={summary.entryTotals.icost}
                onNote={setNoteText}
                rows={byKind('icost').map((e) => ({
                  id: e.id,
                  note: e.note,
                  cells: [e.entry_date.slice(5), e.description, fmtMoney(Number(e.amount))],
                }))}
              />
              <Block
                title="Ucost"
                tone={TONES.ucost}
                headers={['日期', 'Description', '金額']}
                total={summary.entryTotals.ucost}
                onNote={setNoteText}
                rows={byKind('ucost').map((e) => ({
                  id: e.id,
                  note: e.note,
                  cells: [e.entry_date.slice(5), e.description, fmtMoney(Number(e.amount))],
                }))}
              />
            </div>
          </div>
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={`新增收支 — ${store.name}`}>
        <EntryForm
          storeId={store.id}
          onCancel={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false)
            onEntriesChanged?.()
          }}
        />
      </Modal>

      <Modal open={noteText !== null} onClose={() => setNoteText(null)} title="附註" footer={<Button onClick={() => setNoteText(null)}>關閉</Button>}>
        <p className="whitespace-pre-wrap text-sm text-gray-700">{noteText}</p>
      </Modal>

      <Modal
        open={!!balanceForm}
        onClose={() => setBalanceForm(null)}
        title={`期初餘額 — ${store.name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBalanceForm(null)}>
              取消
            </Button>
            <Button onClick={saveBalance}>儲存</Button>
          </>
        }
      >
        {balanceForm && (
          <div className="space-y-3">
            <Notice kind="info">
              COH / UCOH 由這個起點逐月自動累計；起點之前的資料不會計入。之後修改任何舊月份，後面各月的「上月月底」會跟著重算。
            </Notice>
            <Field label="從哪個月開始記帳">
              <input
                type="month"
                className={`${inputCls} w-full`}
                value={balanceForm.month}
                onChange={(e) => setBalanceForm({ ...balanceForm, month: e.target.value })}
              />
            </Field>
            <Field label="該月月初的 COH">
              <MoneyInput value={balanceForm.coh} onChange={(v) => setBalanceForm({ ...balanceForm, coh: v })} className="!border-brand-200 !bg-white !text-left" />
            </Field>
            <Field label="該月月初的 UCOH">
              <MoneyInput value={balanceForm.ucoh} onChange={(v) => setBalanceForm({ ...balanceForm, ucoh: v })} className="!border-brand-200 !bg-white !text-left" />
            </Field>
            {balanceForm.error && <Notice kind="error">{balanceForm.error}</Notice>}
          </div>
        )}
      </Modal>
    </div>
  )
}
