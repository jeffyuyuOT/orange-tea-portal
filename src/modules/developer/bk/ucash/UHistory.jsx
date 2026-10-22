import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../../components/ui/LoadingSpinner'
import {
  ENTRY_KIND_LABELS,
  RUJU_TARGET_LABELS,
  brisbaneToday,
  brisbaneTodayStr,
  computeCashDay,
  computeCashSummary,
  daysInMonth,
  dwSigned,
  fmtMoney,
  monthDates,
  monthLabel,
  monthStart,
  round2,
  sfOcaMapFromRows,
  toNum,
  ymd,
} from '../bkUtils'
import { listCashDayRows, listCashMonths, listEntries, loadCashMonth } from '../bkData'
import { exportCashXlsx, exportPlXlsx } from '../bkExcel'
import { NoteButton, Notice, inputCls } from '../bkUi'
import EntryForm from './EntryForm'

const VIEWS = [
  ['store', '分店現金'],
  ['items', '個別資料'],
  ['pl', 'P/L'],
]

// 個別資料 categories. ids: icost / ucost / dw / ruju / transfer come from
// 收支 (分店transfer is a 'ucost' row with transfer_group_id set — "Ucost"
// here means a PLAIN Ucost row, excluding transfers, so the two never
// double-count the same row); d / pm come from the daily table.
const ITEM_KINDS = [
  ['icost', 'Icost'],
  ['ucost', 'Ucost'],
  ['other_income', '其他收入'],
  ['dw', 'deposit / withdraw'],
  ['ruju', '入金'],
  ['transfer', '分店transfer'],
  ['d', 'D 欄'],
  ['pm', '+/− 欄'],
]

export default function UHistory({ stores, storeId: initialStoreId, active, onLoad }) {
  const [view, setView] = useState('store')
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {VIEWS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setView(k)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${
              view === k ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'store' ? (
        <StoreMonths stores={stores} initialStoreId={initialStoreId} active={active} onLoad={onLoad} />
      ) : view === 'items' ? (
        <ItemHistory stores={stores} initialStoreId={initialStoreId} active={active} />
      ) : (
        <PlHistory stores={stores} initialStoreId={initialStoreId} active={active} />
      )}
    </div>
  )
}

// One store/month's P/L, independent of opening balances (bkUtils.computeCashSummary).
async function computePlForStoreMonth(storeId, year, month) {
  const from = monthStart(year, month)
  const dates = monthDates(year, month)
  const to = dates[dates.length - 1]
  const { cashDays, sfDays } = await listCashDayRows({ storeId, from, to })
  const ocaByDay = new Map(sfDays.map((r) => [r.day, toNum(r.o_ca)]))
  const cashByDay = new Map(cashDays.map((c) => [c.day, c]))
  const dayRows = dates.map((date) => ({ date, ...computeCashDay(ocaByDay.get(date) ?? 0, cashByDay.get(date) ?? null) }))
  const entries = await listEntries({ storeId, from, to, kinds: ['ucost'] })
  return computeCashSummary(0, 0, dayRows, entries).pl
}

// Every (year, month) from `from`'s month to `to`'s month, inclusive.
function monthsBetween(from, to) {
  const [fy, fm] = from.slice(0, 7).split('-').map(Number)
  const [ty, tm] = to.slice(0, 7).split('-').map(Number)
  const out = []
  let y = fy
  let m = fm
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ year: y, month: m })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

// 分店現金 view: one store's months (month + D total), with 載入 / 匯出.
function StoreMonths({ stores, initialStoreId, active, onLoad }) {
  const [storeId, setStoreId] = useState(initialStoreId)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [yearFilter, setYearFilter] = useState(0)
  const [monthFilter, setMonthFilter] = useState(0)

  useEffect(() => {
    if (active) setStoreId(initialStoreId)
  }, [active, initialStoreId])

  useEffect(() => {
    if (!active || !storeId) return
    let cancelled = false
    setLoading(true)
    setError('')
    listCashMonths(storeId)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [active, storeId])

  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a), [rows])
  const shown = rows.filter((r) => (!yearFilter || r.year === yearFilter) && (!monthFilter || r.month === monthFilter))
  const storeName = stores.find((s) => s.id === storeId)?.name ?? ''

  async function exportRow(r) {
    setError('')
    try {
      const data = await loadCashMonth(storeId, r.year, r.month)
      const cashDaysMap = {}
      for (const d of data.cashDays) cashDaysMap[d.day] = d
      await exportCashXlsx({
        storeName,
        year: r.year,
        month: r.month,
        open: data.open,
        sfDaysMap: sfOcaMapFromRows(data.sfDays),
        cashDaysMap,
        entries: data.entries,
      })
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select className={inputCls} value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value)} aria-label="Store">
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className={inputCls} value={yearFilter} onChange={(e) => setYearFilter(Number(e.target.value))} aria-label="Year">
          <option value={0}>全部年份</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
        <select className={inputCls} value={monthFilter} onChange={(e) => setMonthFilter(Number(e.target.value))} aria-label="Month">
          <option value={0}>全部月份</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m} 月
            </option>
          ))}
        </select>
      </div>
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {loading ? (
        <LoadingSpinner />
      ) : shown.length === 0 ? (
        <EmptyState label="沒有符合的分店現金紀錄。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-100">
          <table className="min-w-full text-sm">
            <thead className="bg-brand-100 text-left text-xs text-gray-700">
              <tr>
                <th className="px-3 py-2">月份</th>
                <th className="px-3 py-2 text-right">D 欄 Total</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{monthLabel(r.year, r.month)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(round2(r.dTotal))}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => onLoad({ storeId, year: r.year, month: r.month })}>
                        載入
                      </Button>
                      <Button variant="secondary" onClick={() => exportRow(r)}>
                        匯出
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// 個別資料 view: pick a store (or all) and a date range (this FY so far by
// default — AU FY starts 1 July), then pick categories from a dropdown one at a time and "加入清單"
// (add to list). Each added category gets its own column with its own total
// at the top; removing a column just drops it from the list.
function ItemHistory({ stores, initialStoreId, active }) {
  const t = brisbaneToday()
  const [storeId, setStoreId] = useState(initialStoreId) // null = all
  const [addedKinds, setAddedKinds] = useState(['icost'])
  const [pendingKind, setPendingKind] = useState('')
  const [from, setFrom] = useState(monthStart(t.month >= 7 ? t.year : t.year - 1, 7))
  const [to, setTo] = useState(brisbaneTodayStr())
  const [rujuTarget, setRujuTarget] = useState('')
  const [byKind, setByKind] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [noteText, setNoteText] = useState(null)
  const [editing, setEditing] = useState(null) // the raw entry being edited
  const [reloadKey, setReloadKey] = useState(0)

  const storeName = (id) => stores.find((s) => s.id === id)?.name ?? ''
  const availableKinds = ITEM_KINDS.filter(([k]) => !addedKinds.includes(k))

  function addKind() {
    const k = pendingKind || availableKinds[0]?.[0]
    if (!k || addedKinds.includes(k)) return
    setAddedKinds((prev) => [...prev, k])
    setPendingKind('')
  }
  function removeKind(k) {
    setAddedKinds((prev) => prev.filter((x) => x !== k))
  }

  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      if (addedKinds.length === 0 || !from || !to) {
        setByKind({})
        return
      }
      setLoading(true)
      setError('')
      try {
        const buckets = {}
        for (const k of addedKinds) buckets[k] = []
        const wantTransfer = addedKinds.includes('transfer')
        const entryKinds = addedKinds.flatMap((k) =>
          k === 'dw' ? ['deposit', 'withdraw'] : k === 'transfer' ? [] : ['icost', 'ucost', 'other_income', 'ruju'].includes(k) ? [k] : []
        )
        if (wantTransfer && !entryKinds.includes('ucost')) entryKinds.push('ucost')
        if (entryKinds.length) {
          const entries = await listEntries({ storeId, from, to, kinds: entryKinds })
          for (const e of entries) {
            if (e.kind === 'ruju' && rujuTarget && e.ruju_target !== rujuTarget) continue
            // A 分店transfer leg is still kind 'ucost' underneath; split it
            // into its own bucket here so "Ucost" and "分店transfer" never
            // double-count the same row.
            let bucketKey = e.kind === 'deposit' || e.kind === 'withdraw' ? 'dw' : e.kind
            if (e.kind === 'ucost') bucketKey = e.transfer_group_id ? 'transfer' : 'ucost'
            if (!buckets[bucketKey]) continue
            buckets[bucketKey].push({
              key: `e-${e.id}`,
              date: e.entry_date,
              store: e.store_id,
              type:
                e.kind === 'ruju'
                  ? `入金（${RUJU_TARGET_LABELS[e.ruju_target]}）`
                  : e.kind === 'ucost' && e.transfer_group_id
                    ? `分店transfer${e.transfer_mode === 'loan_repay' ? '（借貸償還）' : ''}`
                    : ENTRY_KIND_LABELS[e.kind],
              desc: e.description ?? '',
              amount: e.kind === 'deposit' || e.kind === 'withdraw' ? dwSigned(e) : Number(e.amount),
              note: e.note,
              entry: e.transfer_group_id ? null : e,
            })
          }
        }
        if (buckets.d || buckets.pm) {
          const { cashDays, sfDays } = await listCashDayRows({ storeId, from, to })
          const oca = new Map(sfDays.map((r) => [`${r.bk_sf_months.store_id}|${r.day}`, toNum(r.o_ca)]))
          for (const c of cashDays) {
            const d = toNum(c.d_amount)
            if (buckets.d && d !== null) {
              buckets.d.push({ key: `d-${c.store_id}-${c.day}`, date: c.day, store: c.store_id, type: 'D 欄', desc: c.d_stocked ? '已入庫' : '未入庫', amount: d })
            }
            const actual = toNum(c.actual_ca)
            if (buckets.pm && actual !== null) {
              buckets.pm.push({
                key: `p-${c.store_id}-${c.day}`,
                date: c.day,
                store: c.store_id,
                type: '+/− 欄',
                desc: '實 CA − O.CA',
                amount: round2(actual - (oca.get(`${c.store_id}|${c.day}`) ?? 0)),
              })
            }
          }
        }
        for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        if (!cancelled) setByKind(buckets)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, storeId, addedKinds, from, to, rujuTarget, reloadKey])

  const grandTotal = round2(addedKinds.reduce((a, k) => a + (byKind[k] ?? []).reduce((aa, r) => aa + r.amount, 0), 0))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={inputCls}
          value={storeId ?? ''}
          onChange={(e) => setStoreId(e.target.value || null)}
          aria-label="Store"
        >
          <option value="">全部分店</option>
          {stores.map((s) => (
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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className={inputCls} value={pendingKind} onChange={(e) => setPendingKind(e.target.value)} aria-label="資料種類">
          <option value="">選擇資料種類…</option>
          {availableKinds.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={addKind} disabled={availableKinds.length === 0}>
          加入清單
        </Button>
        {addedKinds.includes('ruju') && (
          <select className={inputCls} value={rujuTarget} onChange={(e) => setRujuTarget(e.target.value)} aria-label="入金對象">
            <option value="">入金：全部</option>
            <option value="jeff_bank">入 Jeff bank</option>
            <option value="mao_safe">入 Mao 保險箱</option>
            <option value="other">其他</option>
          </select>
        )}
      </div>

      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {addedKinds.length === 0 ? (
        <EmptyState label="請從上面選擇資料種類，加入清單。" />
      ) : loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm">
            全部加總 Total：<span className="text-lg font-semibold tabular-nums text-brand-900">{fmtMoney(grandTotal)}</span>
            {addedKinds.length > 1 && <span className="ml-2 text-xs text-gray-500">（每欄各自計算，這裡是全部欄加總）</span>}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {addedKinds.map((k) => {
              const label = ITEM_KINDS.find(([id]) => id === k)?.[1] ?? k
              const list = byKind[k] ?? []
              const colTotal = round2(list.reduce((a, r) => a + r.amount, 0))
              return (
                <div key={k} className="min-w-[280px] flex-1 rounded-xl border border-brand-100">
                  <div className="flex items-center justify-between gap-2 border-b border-brand-100 bg-brand-100 px-3 py-2">
                    <div className="text-sm font-semibold text-gray-700">{label}</div>
                    <button
                      type="button"
                      onClick={() => removeKind(k)}
                      className="text-xs text-gray-500 hover:text-red-600"
                      aria-label={`移除 ${label}`}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="border-b border-brand-100 bg-brand-50/60 px-3 py-2 text-sm">
                    Total：<span className="font-semibold tabular-nums text-brand-900">{fmtMoney(colTotal)}</span>
                    <span className="ml-1 text-xs text-gray-500">（{list.length} 筆）</span>
                  </div>
                  {list.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-gray-400">沒有符合的資料。</div>
                  ) : (
                    <div className="max-h-[480px] overflow-y-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-brand-50 text-left text-xs text-gray-600">
                          <tr>
                            <th className="px-2 py-1.5">日期</th>
                            {!storeId && <th className="px-2 py-1.5">分店</th>}
                            <th className="px-2 py-1.5">Description</th>
                            <th className="px-2 py-1.5 text-right">金額</th>
                            <th className="px-2 py-1.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r) => (
                            <tr key={r.key} className="border-t border-gray-100">
                              <td className="whitespace-nowrap px-2 py-1.5">{r.date}</td>
                              {!storeId && <td className="px-2 py-1.5">{storeName(r.store)}</td>}
                              <td className="px-2 py-1.5">
                                <span className="mr-1 rounded bg-gray-100 px-1 text-xs text-gray-500">{r.type}</span>
                                {r.desc}
                                <NoteButton note={r.note} onOpen={setNoteText} />
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(r.amount)}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                {r.entry && (
                                  <button
                                    type="button"
                                    onClick={() => setEditing(r.entry)}
                                    className="rounded border border-brand-200 px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50"
                                  >
                                    編輯
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
      <Modal open={noteText !== null} onClose={() => setNoteText(null)} title="附註" footer={<Button onClick={() => setNoteText(null)}>關閉</Button>}>
        <p className="whitespace-pre-wrap text-sm text-gray-700">{noteText}</p>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`編輯收支${editing ? ` — ${storeName(editing.store_id)}` : ''}`}>
        {editing && (
          <EntryForm
            storeId={editing.store_id}
            stores={stores}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              setReloadKey((k) => k + 1)
            }}
          />
        )}
      </Modal>
    </div>
  )
}

// P/L view: pick a store (or 全部) and a date range, show every month's P/L
// (independent of opening COH/UCOH — bkUtils.computeCashSummary), a Total
// banner, and an Excel export.
function PlHistory({ stores, initialStoreId, active }) {
  const t = brisbaneToday()
  const [storeId, setStoreId] = useState(initialStoreId) // null = 全部分店
  const [from, setFrom] = useState(monthStart(t.year, t.month))
  const [to, setTo] = useState(brisbaneTodayStr())
  const [fyMode, setFyMode] = useState(false)
  // AU financial year: starting year Y covers Y-07-01 to (Y+1)-06-30 — "24-25FY"
  // for Y=2024. Default to whichever FY today falls in.
  const [fyStartYear, setFyStartYear] = useState(t.month >= 7 ? t.year : t.year - 1)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fyLabel = `${String(fyStartYear).slice(-2)}-${String(fyStartYear + 1).slice(-2)}FY`
  const fyYearOptions = Array.from({ length: 8 }, (_, i) => t.year + 1 - i)

  // Selecting a FY, or changing its start year, drives from/to directly —
  // same date-range state the manual 從/到 pickers use, just computed instead
  // of typed.
  useEffect(() => {
    if (!fyMode) return
    setFrom(monthStart(fyStartYear, 7))
    setTo(ymd(fyStartYear + 1, 6, daysInMonth(fyStartYear + 1, 6)))
  }, [fyMode, fyStartYear])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      if (!from || !to) {
        setRows([])
        return
      }
      setLoading(true)
      setError('')
      try {
        const months = monthsBetween(from, to)
        const targetStores = storeId ? stores.filter((s) => s.id === storeId) : stores
        const combos = targetStores.flatMap((s) => months.map(({ year, month }) => ({ s, year, month })))
        const out = await Promise.all(
          combos.map(async ({ s, year, month }) => ({
            key: `${s.id}-${year}-${month}`,
            storeId: s.id,
            storeName: s.name,
            year,
            month,
            pl: await computePlForStoreMonth(s.id, year, month),
          }))
        )
        out.sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month))
        if (!cancelled) setRows(out)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, storeId, from, to, stores])

  const total = round2(rows.reduce((a, r) => a + r.pl, 0))

  async function doExport() {
    setError('')
    try {
      const storeLabel = storeId ? stores.find((s) => s.id === storeId)?.name ?? '' : '全部分店'
      const title = fyMode ? `${storeLabel} P_L ${fyLabel}` : `${storeLabel} P_L`
      await exportPlXlsx({
        title,
        showStore: !storeId,
        rows: rows.map((r) => ({ storeName: r.storeName, monthLabel: monthLabel(r.year, r.month), pl: r.pl })),
        total,
      })
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={inputCls}
          value={storeId ?? ''}
          onChange={(e) => setStoreId(e.target.value || null)}
          aria-label="Store"
        >
          <option value="">全部分店</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={fyMode} onChange={(e) => setFyMode(e.target.checked)} />
          FY
        </label>
        {fyMode && (
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            起始年度
            <select
              className={inputCls}
              value={fyStartYear}
              onChange={(e) => setFyStartYear(Number(e.target.value))}
              aria-label="FY 起始年度"
            >
              {fyYearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <span className="font-medium text-brand-700">{fyLabel}</span>
          </label>
        )}
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          從
          <input
            type="date"
            className={`${inputCls} ${fyMode ? 'bg-gray-50 text-gray-400' : ''}`}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={fyMode}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          到
          <input
            type="date"
            className={`${inputCls} ${fyMode ? 'bg-gray-50 text-gray-400' : ''}`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={fyMode}
          />
        </label>
        <Button variant="secondary" onClick={doExport} disabled={rows.length === 0}>
          匯出 Excel
        </Button>
      </div>

      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm">
            Total P/L{fyMode && <span className="ml-1 text-gray-500">（{fyLabel}）</span>}：
            <span className={`text-lg font-semibold tabular-nums ${total < 0 ? 'text-red-600' : 'text-brand-900'}`}>{fmtMoney(total)}</span>
          </div>
          {rows.length === 0 ? (
            <EmptyState label="這個範圍沒有符合的月份。" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-brand-100">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-100 text-left text-xs text-gray-700">
                  <tr>
                    {!storeId && <th className="px-3 py-2">分店</th>}
                    <th className="px-3 py-2">月份</th>
                    <th className="px-3 py-2 text-right">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-t border-gray-100">
                      {!storeId && <td className="px-3 py-2">{r.storeName}</td>}
                      <td className="px-3 py-2 font-medium">{monthLabel(r.year, r.month)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.pl < 0 ? 'text-red-600' : ''}`}>{fmtMoney(r.pl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
