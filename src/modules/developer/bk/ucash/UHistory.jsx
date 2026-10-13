import { useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../../components/ui/LoadingSpinner'
import {
  ENTRY_KIND_LABELS,
  RUJU_TARGET_LABELS,
  brisbaneToday,
  brisbaneTodayStr,
  dwSigned,
  fmtMoney,
  monthLabel,
  monthStart,
  round2,
  sfOcaMapFromRows,
  toNum,
} from '../bkUtils'
import { listCashDayRows, listCashMonths, listEntries, loadCashMonth } from '../bkData'
import { exportCashXlsx } from '../bkExcel'
import { NoteButton, Notice, inputCls } from '../bkUi'

const VIEWS = [
  ['store', '分店現金'],
  ['items', '個別資料'],
]

// 個別資料 categories. ids: icost / ucost / dw / ruju come from 收支;
// d / pm come from the daily table.
const ITEM_KINDS = [
  ['icost', 'Icost'],
  ['ucost', 'Ucost'],
  ['other_income', '其他收入'],
  ['dw', 'deposit / withdraw'],
  ['ruju', '入金'],
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
      ) : (
        <ItemHistory stores={stores} initialStoreId={initialStoreId} active={active} />
      )}
    </div>
  )
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

// 個別資料 view: pick a store (or all), one or more categories and a date range
// (this month so far by default) -> the matching lines and their total.
function ItemHistory({ stores, initialStoreId, active }) {
  const t = brisbaneToday()
  const [storeId, setStoreId] = useState(initialStoreId) // null = all
  const [kinds, setKinds] = useState(['icost'])
  const [from, setFrom] = useState(monthStart(t.year, t.month))
  const [to, setTo] = useState(brisbaneTodayStr())
  const [rujuTarget, setRujuTarget] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [noteText, setNoteText] = useState(null)

  const storeName = (id) => stores.find((s) => s.id === id)?.name ?? ''
  const toggleKind = (k) => setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))

  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      if (kinds.length === 0 || !from || !to) {
        setRows([])
        return
      }
      setLoading(true)
      setError('')
      try {
        const out = []
        const entryKinds = kinds.flatMap((k) => (k === 'dw' ? ['deposit', 'withdraw'] : ['icost', 'ucost', 'other_income', 'ruju'].includes(k) ? [k] : []))
        if (entryKinds.length) {
          const entries = await listEntries({ storeId, from, to, kinds: entryKinds })
          for (const e of entries) {
            if (e.kind === 'ruju' && rujuTarget && e.ruju_target !== rujuTarget) continue
            out.push({
              key: `e-${e.id}`,
              date: e.entry_date,
              store: e.store_id,
              type: e.kind === 'ruju' ? `入金（${RUJU_TARGET_LABELS[e.ruju_target]}）` : ENTRY_KIND_LABELS[e.kind],
              desc: e.description ?? '',
              amount: e.kind === 'deposit' || e.kind === 'withdraw' ? dwSigned(e) : Number(e.amount),
              note: e.note,
            })
          }
        }
        if (kinds.includes('d') || kinds.includes('pm')) {
          const { cashDays, sfDays } = await listCashDayRows({ storeId, from, to })
          const oca = new Map(sfDays.map((r) => [`${r.bk_sf_months.store_id}|${r.day}`, toNum(r.o_ca)]))
          for (const c of cashDays) {
            const d = toNum(c.d_amount)
            if (kinds.includes('d') && d !== null) {
              out.push({ key: `d-${c.store_id}-${c.day}`, date: c.day, store: c.store_id, type: 'D 欄', desc: c.d_stocked ? '已入庫' : '未入庫', amount: d })
            }
            const actual = toNum(c.actual_ca)
            if (kinds.includes('pm') && actual !== null) {
              out.push({
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
        out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
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
  }, [active, storeId, kinds, from, to, rujuTarget])

  const total = round2(rows.reduce((a, r) => a + r.amount, 0))

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {ITEM_KINDS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} />
            {label}
          </label>
        ))}
        {kinds.includes('ruju') && (
          <select className={inputCls} value={rujuTarget} onChange={(e) => setRujuTarget(e.target.value)} aria-label="入金對象">
            <option value="">入金：全部</option>
            <option value="jeff_bank">入 Jeff bank</option>
            <option value="mao_safe">入 Mao 保險箱</option>
            <option value="other">其他</option>
          </select>
        )}
      </div>

      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {kinds.length === 0 ? (
        <EmptyState label="請至少選擇一種資料。" />
      ) : loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm">
            符合條件共 {rows.length} 筆，Total：<span className="text-lg font-semibold tabular-nums text-brand-900">{fmtMoney(total)}</span>
            {kinds.length > 1 && <span className="ml-2 text-xs text-gray-500">（多種類別的金額直接相加）</span>}
          </div>
          {rows.length === 0 ? (
            <EmptyState label="這個範圍沒有符合的資料。" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-brand-100">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-100 text-left text-xs text-gray-700">
                  <tr>
                    <th className="px-3 py-2">日期</th>
                    <th className="px-3 py-2">分店</th>
                    <th className="px-3 py-2">種類</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                      <td className="px-3 py-2">{storeName(r.store)}</td>
                      <td className="px-3 py-2">{r.type}</td>
                      <td className="px-3 py-2">
                        {r.desc}
                        <NoteButton note={r.note} onOpen={setNoteText} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <Modal open={noteText !== null} onClose={() => setNoteText(null)} title="附註" footer={<Button onClick={() => setNoteText(null)}>關閉</Button>}>
        <p className="whitespace-pre-wrap text-sm text-gray-700">{noteText}</p>
      </Modal>
    </div>
  )
}
