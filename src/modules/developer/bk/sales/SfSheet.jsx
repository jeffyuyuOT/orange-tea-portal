import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import Badge from '../../../../components/ui/Badge'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import {
  buildColumns,
  computeSfDay,
  computeSfTotals,
  countSfDataDays,
  dMapFromRows,
  fmtMoney,
  inactiveIdsWithData,
  isCashColumn,
  isPosTotalColumn,
  isWeekend,
  KIOSK_NAME,
  kioskMismatch,
  sfDayHasData,
  monthDates,
  monthLabel,
  numToInput,
  sfDayCountMismatch,
  sfDaysFromRows,
  sfSubmitProblems,
  weekdayOf,
} from '../bkUtils'
import { loadCashDays, loadPaymentTypes, loadSfMonth, saveSfMonth } from '../bkData'
import { exportSfXlsx } from '../bkExcel'
import { loadStoreMonthForSubmit, submitStoreMonth } from './sfSubmitAll'
import { loadSalesMonth } from '../bkSalesData'
import { selfOMapFromRows } from '../bkSalesUtils'
import { MoneyInput, Notice, StoreTabs, YearMonthPicker } from '../bkUi'
import ImportByImage from './ImportByImage'
import MyobFillModal from './MyobFillModal'
import ReplyAccountantModal from './ReplyAccountantModal'

const emptyDay = () => ({ o_ca: '', o_post: '', total: '', amounts: {} })

// The SF sub-tab: store tabs, year/month, Save / Submit / Action, and the
// month table (Date | main payment types | Total | Sum vs Total | sub payment
// types | O.CA). Cash is never typed — it is O.CA − D, D coming from U帳.
//
// Self order kiosk and the 營業 tab: for a store linked there, an empty kiosk
// cell falls back to 營業's Self O for that day (grey placeholder); a figure typed
// here always wins and can be changed by hand. When both exist and differ, the
// cell gets a ⚠ — click it to see the 營業 number.
export default function SfSheet({ stores, salesStores, store, year, month, typesVersion, active, onNavigate, onDirtyChange, onSaveReady }) {
  const [types, setTypes] = useState([])
  const [sfMonth, setSfMonth] = useState(null)
  const [days, setDays] = useState({})
  const [dMap, setDMap] = useState({})
  const [selfOMap, setSelfOMap] = useState({}) // 營業 Self O per day (linked stores only)
  const [kioskWarn, setKioskWarn] = useState(null) // { date, typeId, sf, biz }
  const bizStoreId = salesStores?.find((s) => s.sf_store_id === store.id)?.id ?? null
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [problems, setProblems] = useState(null)
  const [mismatch, setMismatch] = useState(null) // { reference, counts: [{ id, name, days }] }
  const [myobOpen, setMyobOpen] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  // The saved month row of what is on screen (keyed, so a save can never use another store / month's row)
  const monthKey = `${store.id}|${year}|${month}`
  const sfMonthRef = useRef({ key: '', month: null })
  const saveQueue = useRef(Promise.resolve())

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Hand the parent a "save as draft" function (→ true / false): used when
  // leaving the store / month and by BK's 儲存 button. Unsubmitted typing is kept
  // as a draft, so nothing is lost and nothing needs asking.
  const persistRef = useRef(null)
  persistRef.current = persist
  useEffect(() => {
    onSaveReady?.(() => persistRef.current(false))
    return () => onSaveReady?.(null)
  }, [onSaveReady])

  // Columns of this store (re-read after 資料維護 changes them).
  useEffect(() => {
    let cancelled = false
    loadPaymentTypes(store.id)
      .then((rows) => !cancelled && setTypes(rows))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [store.id, typesVersion])

  // The month's saved data. Changing store / month replaces whatever is on
  // screen (the parent already asked about unsaved changes before navigating).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setMsg('')
      try {
        const [sf, cash, biz] = await Promise.all([
          loadSfMonth(store.id, year, month),
          loadCashDays(store.id, year, month),
          bizStoreId ? loadSalesMonth(bizStoreId, year, month) : Promise.resolve([]),
        ])
        if (cancelled) return
        setSfMonth(sf.sfMonth)
        sfMonthRef.current = { key: monthKey, month: sf.sfMonth }
        setDays(sfDaysFromRows(sf.days))
        setDMap(dMapFromRows(cash))
        setSelfOMap(selfOMapFromRows(biz))
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
  }, [store.id, bizStoreId, year, month])

  // D can change in U帳 (and Self O in 營業) while this tab is hidden — re-read
  // them when coming back.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadCashDays(store.id, year, month)
      .then((rows) => !cancelled && setDMap(dMapFromRows(rows)))
      .catch(() => {})
    if (bizStoreId) {
      loadSalesMonth(bizStoreId, year, month)
        .then((rows) => !cancelled && setSelfOMap(selfOMapFromRows(rows)))
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [active, store.id, bizStoreId, year, month])

  const dates = useMemo(() => monthDates(year, month), [year, month])
  const columns = useMemo(() => buildColumns(types, inactiveIdsWithData(types, days)), [types, days])
  const subs = useMemo(() => columns.flatMap((c) => c.subs.map((s) => ({ ...s, parentName: c.name }))), [columns])
  // date 58 + check 44 + about 66px for each money column (mains, Total, subs, O.CA, O.POST)
  const tableMinWidth = 58 + 44 + 66 * (columns.length + 1 + subs.length + 2)
  const kioskType = useMemo(() => subs.find((s) => s.name === KIOSK_NAME) ?? null, [subs])
  const rows = useMemo(
    () =>
      dates.map((date) =>
        computeSfDay(columns, days[date] ?? emptyDay(), dMap[date] ?? null, bizStoreId ? (selfOMap[date] ?? null) : undefined)
      ),
    [dates, columns, days, dMap, selfOMap, bizStoreId]
  )
  const totals = useMemo(() => computeSfTotals(columns, rows), [columns, rows])

  function setField(date, field, value) {
    setDays((prev) => ({ ...prev, [date]: { ...(prev[date] ?? emptyDay()), [field]: value } }))
    setDirty(true)
    setMsg('')
  }
  function setAmount(date, typeId, value) {
    setDays((prev) => {
      const cur = prev[date] ?? emptyDay()
      return { ...prev, [date]: { ...cur, amounts: { ...cur.amounts, [typeId]: value } } }
    })
    setDirty(true)
    setMsg('')
  }

  // Saves run one after another (typing autosave, leaving a store, 儲存, 提交 can overlap).
  function persist(submit, opts) {
    const run = () => doPersist(submit, opts)
    const p = saveQueue.current.then(run, run)
    saveQueue.current = p.catch(() => {})
    return p
  }

  async function doPersist(submit, { silent = false } = {}) {
    setSaving(true)
    setError('')
    if (!silent) setMsg('')
    try {
      // Total is never typed: store the calculated one (Pos total + Self order kiosk).
      const daysToSave = Object.fromEntries(
        dates.map((date, i) => [date, { ...(days[date] ?? emptyDay()), total: numToInput(rows[i].total) }])
      )
      const existing = sfMonthRef.current.key === monthKey ? sfMonthRef.current.month : sfMonth
      const saved = await saveSfMonth({ storeId: store.id, year, month, existing, days: daysToSave, submit })
      sfMonthRef.current = { key: monthKey, month: saved }
      setSfMonth(saved)
      setDirty(false)
      if (!silent) setMsg(submit ? '已提交。' : '已儲存（狀態：未提交）。')
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  // Typing is kept as a draft by itself a moment after you stop (so U帳 sees
  // the new O.CA without a 提交). Silent: no message.
  useEffect(() => {
    if (!dirty || loading) return
    const t = setTimeout(() => persistRef.current?.(false, { silent: true }), 1200)
    return () => clearTimeout(t)
  }, [dirty, days, loading])

  // 提交 = submit ALL stores' month. Checks (all stores): (1) a day with any other
  // main payment figure needs Cash; (2) every store should have the same number
  // of days with data — that one only warns, 仍要提交 goes on.
  async function loadOthers() {
    const others = stores.filter((s) => s.id !== store.id)
    return Promise.all(others.map((s) => loadStoreMonthForSubmit(s, salesStores, year, month)))
  }

  async function submit() {
    setSaving(true)
    setError('')
    try {
      const loaded = await loadOthers()
      const found = sfSubmitProblems(dates, days, columns).map((p) => ({ ...p, storeName: store.name }))
      for (const m of loaded) {
        found.push(...sfSubmitProblems(m.dates, m.days, m.columns).map((p) => ({ ...p, storeName: m.store.name })))
      }
      if (found.length > 0) {
        setProblems(found)
        return
      }
      // this store: what is on screen; the others: what is saved
      const counts = stores.map((s) => ({
        id: s.id,
        name: s.name,
        days: s.id === store.id ? countSfDataDays(days) : (loaded.find((m) => m.store.id === s.id)?.dataDays ?? 0),
      }))
      const { reference, mismatched } = sfDayCountMismatch(counts)
      if (mismatched.length > 0) {
        setMismatch({ reference, counts })
        return
      }
    } catch (e) {
      setError(`無法檢查各分店：${e.message}`)
      return
    } finally {
      setSaving(false)
    }
    await submitAll()
  }

  // Submit the store on screen (from the screen) and every other store that has data (from the saved data).
  async function submitAll() {
    setError('')
    try {
      const loaded = await loadOthers()
      const ok = await persist(true, { silent: true })
      if (!ok) return
      let n = 1
      setSaving(true)
      for (const m of loaded) {
        if (m.dataDays === 0) continue
        await submitStoreMonth(m, year, month)
        n++
      }
      setMsg(`已提交 ${monthLabel(year, month)} 全部分店（${n} 間）。`)
    } catch (e) {
      setError(`提交失敗：${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function doExport() {
    try {
      await exportSfXlsx({ storeName: store.name, year, month, columns, days, dMap, kioskMap: bizStoreId ? selfOMap : undefined })
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    }
  }

  // 匯入 Excel / 匯入 by 圖檔: the picked file is previewed in SfExcelImport (or the
  // image review step); 套用 fills the sheet (never saves). Only the cells the file actually has are touched.
  function applyImport(entries, source = 'Excel') {
    setDays((prev) => {
      const next = { ...prev }
      for (const [date, entry] of Object.entries(entries)) {
        const cur = next[date] ?? emptyDay()
        const amounts = { ...cur.amounts }
        for (const [id, v] of Object.entries(entry.amounts)) amounts[id] = numToInput(v)
        next[date] = {
          ...cur,
          o_ca: entry.o_ca !== undefined ? numToInput(entry.o_ca) : cur.o_ca,
          o_post: entry.o_post !== undefined ? numToInput(entry.o_post) : cur.o_post,
          total: entry.total !== undefined ? numToInput(entry.total) : cur.total,
          amounts,
        }
      }
      return next
    })
    setDirty(true)
    setError('')
    setMsg(`已把 ${Object.keys(entries).length} 天的${source}資料填進表格，請檢查後按「提交」。`)
  }

  // Enter moves to the same column on the next day, like a spreadsheet.
  function onKeyDown(e, rowIdx, colKey) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = e.currentTarget.closest('table')?.querySelector(`[data-sf="${rowIdx + 1}:${colKey}"]`)
    if (next) {
      next.focus()
      next.select?.()
    }
  }

  const status = dirty
    ? { color: 'brand', text: '有未提交的變更' }
    : !sfMonth
      ? { color: 'gray', text: '尚未提交' }
      : sfMonth.status === 'submitted'
        ? { color: 'green', text: '已提交' }
        : { color: 'red', text: '未提交' }
  const canExport = sfMonth?.status === 'submitted' && !dirty

  const th = 'border border-brand-100 px-1 py-1.5 text-[11px] font-semibold leading-tight text-gray-700'
  const td = 'border border-gray-100 p-0'
  const inputFor = (i, colKey, value, onChange, extra) => (
    <MoneyInput
      value={value}
      onChange={onChange}
      {...extra}
      className="!px-1 !text-[13px]"
      data-sf={`${i}:${colKey}`}
      onKeyDown={(e) => onKeyDown(e, i, colKey)}
    />
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <StoreTabs stores={stores} storeId={store.id} onChange={(id) => onNavigate({ storeId: id })} />
        </div>
        <Button onClick={submit} disabled={saving || loading} title="提交全部分店這個月的SF">
          提交全部分店
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-brand-900">{store.name}</span>
        <YearMonthPicker year={year} month={month} onChange={(v) => onNavigate(v)} />
        <Badge color={status.color}>{status.text}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value
              if (v === 'myob') setMyobOpen(true)
              else if (v === 'reply') setReplyOpen(true)
              else if (v === 'export') doExport()
            }}
            className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-700"
            aria-label="Action"
          >
            <option value="">Action</option>
            <option value="myob">填入會計表</option>
            <option value="reply">回復會計</option>
            <option value="export" disabled={!canExport}>
              匯出 Excel{canExport ? '' : '（要先提交且沒有未提交變更）'}
            </option>
          </select>
        </div>
      </div>


      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}
      {sfMonth?.status === 'submitted' && dirty && (
        <Notice kind="info">這個月已提交；修改後會先暫存成「未提交」，要再按「提交」才算正式提交。</Notice>
      )}

      <ImportByImage columns={columns} year={year} month={month} days={days} onApply={applyImport} />

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-brand-100">
          {/* Compact layout: fixed column widths that share the page width, so the
              whole month fits without sliding sideways (date and check columns are
              narrow; every money column gets an equal share). It only scrolls
              sideways when the window is narrower than minWidth. */}
          <table className="w-full table-fixed border-collapse text-[13px]" style={{ minWidth: tableMinWidth }}>
            <colgroup>
              <col style={{ width: 58 }} />
              {columns.map((c) => (
                <col key={c.id} />
              ))}
              <col />
              <col style={{ width: 44 }} />
              {subs.map((s) => (
                <col key={s.id} />
              ))}
              <col />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <th className={`${th} sticky left-0 z-30 bg-brand-100 text-left`}>日期</th>
                {columns.map((c) => (
                  <th key={c.id} className={`${th} bg-brand-100`}>
                    {c.name}
                    {!c.is_active && <div className="text-[10px] font-normal text-gray-400">(已停用)</div>}
                    {c.subs.length > 0 && <div className="text-[10px] font-normal text-gray-500">= sub 加總</div>}
                    {isCashColumn(c) && <div className="text-[10px] font-normal text-gray-500">= O.CA − D</div>}
                    {isPosTotalColumn(c) && <div className="text-[10px] font-normal text-gray-500">= O.POST − D（不計入 Sum）</div>}
                  </th>
                ))}
                <th className={`${th} bg-brand-200`}>
                  Total
                  <div className="text-[10px] font-normal text-gray-500">= Pos total + Self order kiosk</div>
                </th>
                <th className={`${th} bg-gray-100`}>Sum vs Total</th>
                {subs.map((s) => (
                  <th key={s.id} className={`${th} bg-sky-50`}>
                    {s.name}
                    <div className="text-[10px] font-normal text-gray-500">{s.parentName}</div>
                  </th>
                ))}
                <th className={`${th} bg-green-50`}>O.CA</th>
                <th className={`${th} bg-green-50`}>
                  O.POST
                  <div className="text-[10px] font-normal text-gray-500">POS 報表 Total</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => {
                const r = rows[i]
                const day = days[date] ?? emptyDay()
                const weekendBg = isWeekend(date) ? 'bg-gray-50' : 'bg-white'
                return (
                  <tr key={date} className={weekendBg}>
                    <td className={`${td} sticky left-0 z-10 whitespace-nowrap px-1.5 py-1 ${weekendBg}`}>
                      <span className="font-medium">{Number(date.slice(8))}</span>{' '}
                      <span className="text-[11px] text-gray-400">{weekdayOf(date)}</span>
                    </td>
                    {columns.map((c) => {
                      const computed = isCashColumn(c) || isPosTotalColumn(c) || c.subs.length > 0
                      return (
                        <td key={c.id} className={td}>
                          {computed ? (
                            <div
                              className="px-1 py-1 text-right tabular-nums text-gray-700"
                              title={
                                c.subs.length ? '由 sub payment type 加總' : isPosTotalColumn(c) ? 'O.POST − D' : 'O.CA − D'
                              }
                            >
                              {fmtMoney(r.mains[c.id])}
                            </div>
                          ) : (
                            inputFor(i, c.id, day.amounts[c.id], (v) => setAmount(date, c.id, v))
                          )}
                        </td>
                      )
                    })}
                    <td className={td}>
                      <div className="px-1 py-1 text-right font-medium tabular-nums text-gray-700" title="Pos total + Self order kiosk">
                        {fmtMoney(r.total)}
                      </div>
                    </td>
                    <td className={`${td} text-center`}>
                      {r.check === 'ok' && <span className="font-bold text-green-600" title="主 payment 加總（不含 Pos total）= Total">✓</span>}
                      {r.check === 'bad' && (
                        <span
                          className="font-bold text-red-600"
                          title={`主 payment 加總 ${fmtMoney(r.sum) || '—'} ≠ Total ${fmtMoney(r.total) || '—'}`}
                        >
                          ✗
                        </span>
                      )}
                    </td>
                    {subs.map((s) => {
                      const isKiosk = !!bizStoreId && s.id === kioskType?.id
                      const own = day.amounts[s.id]
                      const biz = selfOMap[date]
                      const mismatch = isKiosk ? kioskMismatch(own, biz) : null
                      // empty here, 營業 has a figure: it is what the row uses (shown grey)
                      const fromBiz = isKiosk && (own ?? '') === '' && biz !== null && biz !== undefined && sfDayHasData(day)
                      return (
                        <td key={s.id} className={`${td} relative`}>
                          {mismatch && (
                            <button
                              type="button"
                              onClick={() => setKioskWarn({ date, typeId: s.id, ...mismatch })}
                              title="和營業的 Self O 不一致，點一下看詳細"
                              aria-label="和營業的 Self O 不一致"
                              className="absolute left-0.5 top-1/2 z-10 -translate-y-1/2 text-[12px] leading-none text-amber-600 hover:text-amber-700"
                            >
                              ⚠
                            </button>
                          )}
                          {inputFor(
                            i,
                            s.id,
                            own,
                            (v) => setAmount(date, s.id, v),
                            fromBiz ? { placeholder: numToInput(biz), title: '空白：用營業的 Self O' } : undefined
                          )}
                        </td>
                      )
                    })}
                    <td className={td}>{inputFor(i, 'o_ca', day.o_ca, (v) => setField(date, 'o_ca', v))}</td>
                    <td className={td}>{inputFor(i, 'o_post', day.o_post, (v) => setField(date, 'o_post', v))}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-brand-50 font-semibold">
                <td className={`${td} sticky left-0 z-30 bg-brand-50 px-1.5 py-1.5`}>Total</td>
                {columns.map((c) => (
                  <td key={c.id} className={`${td} px-1 py-1.5 text-right tabular-nums`}>
                    {fmtMoney(totals.mains[c.id])}
                  </td>
                ))}
                <td className={`${td} px-1 py-1.5 text-right tabular-nums`}>{fmtMoney(totals.total)}</td>
                <td className={td} />
                {subs.map((s) => (
                  <td key={s.id} className={`${td} px-1 py-1.5 text-right tabular-nums`}>
                    {fmtMoney(totals.subs[s.id])}
                  </td>
                ))}
                <td className={`${td} px-1 py-1.5 text-right tabular-nums`}>{fmtMoney(totals.oCa)}</td>
                <td className={`${td} px-1 py-1.5 text-right tabular-nums`}>{fmtMoney(totals.oPost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal
        open={!!kioskWarn}
        onClose={() => setKioskWarn(null)}
        title="Self order kiosk 和營業的 Self O 不一致"
        footer={
          <>
            <Button variant="secondary" onClick={() => setKioskWarn(null)}>
              保留SF的數字
            </Button>
            <Button
              onClick={() => {
                setAmount(kioskWarn.date, kioskWarn.typeId, numToInput(kioskWarn.biz))
                setKioskWarn(null)
              }}
            >
              改用營業的數字
            </Button>
          </>
        }
      >
        {kioskWarn && (
          <div className="space-y-2 text-sm text-gray-700">
            <p>{kioskWarn.date} 這一天：</p>
            <ul className="space-y-1">
              <li className="flex justify-between rounded bg-amber-50 px-2 py-1">
                <span>營業的 Self O</span>
                <span className="tabular-nums">{fmtMoney(kioskWarn.biz)}</span>
              </li>
              <li className="flex justify-between rounded bg-amber-50 px-2 py-1">
                <span>SF的 Self order kiosk</span>
                <span className="tabular-nums">{fmtMoney(kioskWarn.sf)}</span>
              </li>
              <li className="flex justify-between rounded bg-gray-50 px-2 py-1">
                <span>差額（SF − 營業）</span>
                <span className="tabular-nums">{fmtMoney(kioskWarn.sf - kioskWarn.biz)}</span>
              </li>
            </ul>
            <p className="text-xs text-gray-400">SF手動輸入的數字優先；如果要跟營業一致，按「改用營業的數字」後記得按「提交」。</p>
          </div>
        )}
      </Modal>

      <Modal
        open={!!problems}
        onClose={() => setProblems(null)}
        title="無法提交：有日期缺少 Cash"
        footer={<Button onClick={() => setProblems(null)}>知道了</Button>}
      >
        <p className="mb-2 text-sm text-gray-600">這些日期已經有其他 payment 的資料，但沒有 Cash（O.CA）的紀錄。完全沒有資料的日期不需要填。缺少的日期：</p>
        <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
          {problems?.map((p) => (
            <li key={`${p.storeName}${p.date}`} className="flex justify-between rounded bg-red-50 px-2 py-1">
              <span>{p.storeName ? `${p.storeName}　${p.date}` : p.date}</span>
              <span className="text-red-600">缺少 {p.missing.join('、')}</span>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={!!mismatch}
        onClose={() => setMismatch(null)}
        title="警示：各分店有資料的天數不一致"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMismatch(null)}>
              回去檢查
            </Button>
            <Button
              onClick={async () => {
                setMismatch(null)
                await submitAll()
              }}
            >
              仍要提交
            </Button>
          </>
        }
      >
        {mismatch && (
          <div className="space-y-2 text-sm">
            <p className="text-gray-600">
              {monthLabel(year, month)} 大部分分店有 {mismatch.reference} 天有資料，但以下分店的天數跟其他店不符
              （目前這間分店以畫面上的資料計算，其他分店以已儲存的資料計算）。按「仍要提交」會提交全部分店：
            </p>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {mismatch.counts.map((c) => {
                const bad = c.days !== mismatch.reference
                return (
                  <li key={c.id} className={`flex justify-between rounded px-2 py-1 ${bad ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <span className={bad ? 'font-medium text-red-700' : ''}>
                      {c.name}
                      {c.id === store.id ? '（目前）' : ''}
                    </span>
                    <span className={bad ? 'text-red-600' : 'text-gray-500'}>
                      {c.days} 天{bad ? '（不符）' : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Modal>
      <ReplyAccountantModal open={replyOpen} onClose={() => setReplyOpen(false)} stores={stores} />
      <MyobFillModal open={myobOpen} onClose={() => setMyobOpen(false)} stores={stores} salesStores={salesStores} year={year} month={month} />
    </div>
  )
}
