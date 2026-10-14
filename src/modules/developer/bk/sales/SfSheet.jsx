import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import Badge from '../../../../components/ui/Badge'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import {
  buildColumns,
  computeSfDay,
  columnCopyText,
  computeSfTotals,
  countSfDataDays,
  dMapFromRows,
  fmtMoney,
  inactiveIdsWithData,
  isCashColumn,
  isPosTotalColumn,
  isWeekend,
  monthDates,
  monthLabel,
  numToInput,
  sfDayCountMismatch,
  sfDaysFromRows,
  sfSubmitProblems,
  weekdayOf,
} from '../bkUtils'
import { loadCashDays, loadPaymentTypes, loadSfDataDayCounts, loadSfMonth, saveSfMonth } from '../bkData'
import { exportSfXlsx } from '../bkExcel'
import { MoneyInput, Notice, StoreTabs, YearMonthPicker } from '../bkUi'
import ImportByImage from './ImportByImage'
import SfExcelImport from './SfExcelImport'

const emptyDay = () => ({ o_ca: '', o_post: '', total: '', amounts: {} })

// The SF sub-tab: store tabs, year/month, Save / Submit / Action, and the
// month table (Date | main payment types | Total | Sum vs Total | sub payment
// types | O.CA). Cash is never typed — it is O.CA − D, D coming from U帳.
export default function SfSheet({ stores, store, year, month, typesVersion, active, onNavigate, onDirtyChange }) {
  const [types, setTypes] = useState([])
  const [sfMonth, setSfMonth] = useState(null)
  const [days, setDays] = useState({})
  const [dMap, setDMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [problems, setProblems] = useState(null)
  const [mismatch, setMismatch] = useState(null) // { reference, counts: [{ id, name, days }] }
  const [copied, setCopied] = useState(null) // type id just copied
  const [menuOpen, setMenuOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

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
        const [sf, cash] = await Promise.all([loadSfMonth(store.id, year, month), loadCashDays(store.id, year, month)])
        if (cancelled) return
        setSfMonth(sf.sfMonth)
        setDays(sfDaysFromRows(sf.days))
        setDMap(dMapFromRows(cash))
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
  }, [store.id, year, month])

  // D can change in U帳 while this tab is hidden — re-read it when coming back.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadCashDays(store.id, year, month)
      .then((rows) => !cancelled && setDMap(dMapFromRows(rows)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, store.id, year, month])

  const dates = useMemo(() => monthDates(year, month), [year, month])
  const columns = useMemo(() => buildColumns(types, inactiveIdsWithData(types, days)), [types, days])
  const subs = useMemo(() => columns.flatMap((c) => c.subs.map((s) => ({ ...s, parentName: c.name }))), [columns])
  // date 58 + check 44 + about 66px for each money column (mains, Total, subs, O.CA, O.POST)
  const tableMinWidth = 58 + 44 + 66 * (columns.length + 1 + subs.length + 2)
  const rows = useMemo(
    () => dates.map((date) => computeSfDay(columns, days[date] ?? emptyDay(), dMap[date] ?? null)),
    [dates, columns, days, dMap]
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

  // Copy one column's month of values (1st … last, one per line) to the clipboard.
  async function copyColumn(typeId, values) {
    const text = columnCopyText(values)
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else throw new Error('no clipboard api')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(typeId)
    setTimeout(() => setCopied((cur) => (cur === typeId ? null : cur)), 1500)
  }

  const copyBtn = (type, values) =>
    type.can_copy ? (
      <button
        type="button"
        onClick={() => copyColumn(type.id, values)}
        title={copied === type.id ? '已複製' : `複製 ${type.name} 整欄數值`}
        aria-label={`複製 ${type.name} 整欄數值`}
        className="absolute right-0.5 top-0.5 rounded px-1 text-xs leading-none text-brand-600 hover:bg-brand-200"
      >
        {copied === type.id ? '✓' : '⧉'}
      </button>
    ) : null

  async function persist(submit) {
    setSaving(true)
    setError('')
    setMsg('')
    try {
      // Total is never typed: store the calculated one (Pos total + Self order kiosk).
      const daysToSave = Object.fromEntries(
        dates.map((date, i) => [date, { ...(days[date] ?? emptyDay()), total: numToInput(rows[i].total) }])
      )
      const saved = await saveSfMonth({ storeId: store.id, year, month, existing: sfMonth, days: daysToSave, submit })
      setSfMonth(saved)
      setDirty(false)
      setMsg(submit ? '已提交。' : '已儲存（狀態：未提交）。')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Submit checks: (1) a day with any other main payment figure needs Cash;
  // (2) every store should have the same number of days with data this month —
  // that one only warns (a store may genuinely have fewer days), 仍要提交 goes on.
  async function submit() {
    const found = sfSubmitProblems(dates, days, columns)
    if (found.length > 0) {
      setProblems(found)
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await loadSfDataDayCounts(year, month)
      const counts = stores.map((s) => ({
        id: s.id,
        name: s.name,
        // this store: what is on screen (may be unsaved); the others: what is saved
        days: s.id === store.id ? countSfDataDays(days) : (saved[s.id] ?? 0),
      }))
      const { reference, mismatched } = sfDayCountMismatch(counts)
      if (mismatched.length > 0) {
        setMismatch({ reference, counts })
        setSaving(false)
        return
      }
    } catch (e) {
      setError(`無法檢查各分店的天數：${e.message}`)
      setSaving(false)
      return
    }
    setSaving(false)
    await persist(true)
  }

  async function doExport() {
    setMenuOpen(false)
    try {
      await exportSfXlsx({ storeName: store.name, year, month, columns, days, dMap })
    } catch (e) {
      setError(`匯出失敗：${e.message}`)
    }
  }

  // 匯入 Excel: the picked file is previewed in SfExcelImport; 套用 fills the
  // sheet (never saves). Only the cells the file actually has are touched.
  function applyImport(entries) {
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
    setImportFile(null)
    setError('')
    setMsg(`已把 ${Object.keys(entries).length} 天的 Excel 資料填進表格，請檢查後按「提交」。`)
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
  const inputFor = (i, colKey, value, onChange) => (
    <MoneyInput
      value={value}
      onChange={onChange}
      className="!px-1 !text-[13px]"
      data-sf={`${i}:${colKey}`}
      onKeyDown={(e) => onKeyDown(e, i, colKey)}
    />
  )

  return (
    <div className="space-y-3">
      <StoreTabs stores={stores} storeId={store.id} onChange={(id) => onNavigate({ storeId: id })} />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-brand-900">{store.name}</span>
        <YearMonthPicker year={year} month={month} onChange={(v) => onNavigate(v)} />
        <Badge color={status.color}>{status.text}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={submit} disabled={saving || loading}>
            提交
          </Button>
          <div className="relative">
            <Button variant="secondary" onClick={() => setMenuOpen((v) => !v)}>
              Action ▾
            </Button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-brand-100 bg-white shadow-lg">
                <button
                  type="button"
                  disabled={!canExport}
                  onClick={doExport}
                  title={canExport ? '' : '只有已提交且沒有未提交變更的 SF 才能匯出'}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                >
                  匯出 Excel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    fileInputRef.current?.click()
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                >
                  匯入 Excel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        data-testid="sf-excel-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = '' // picking the same file again should still fire
          if (f) setImportFile(f)
        }}
      />
      {importFile && (
        <SfExcelImport
          file={importFile}
          columns={columns}
          year={year}
          month={month}
          days={days}
          onApply={applyImport}
          onClose={() => setImportFile(null)}
        />
      )}

      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}
      {sfMonth?.status === 'submitted' && dirty && (
        <Notice kind="info">這個月已提交；修改後要再按「提交」才會儲存這些變更。</Notice>
      )}

      <ImportByImage />

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
                  <th key={c.id} className={`${th} relative bg-brand-100`}>
                    {copyBtn(c, rows.map((r) => r.mains[c.id]))}
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
                  <th key={s.id} className={`${th} relative bg-sky-50`}>
                    {copyBtn(s, rows.map((r) => r.subAmounts[s.id]))}
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
                    {subs.map((s) => (
                      <td key={s.id} className={td}>
                        {inputFor(i, s.id, day.amounts[s.id], (v) => setAmount(date, s.id, v))}
                      </td>
                    ))}
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
        open={!!problems}
        onClose={() => setProblems(null)}
        title="無法提交：有日期缺少 Cash"
        footer={<Button onClick={() => setProblems(null)}>知道了</Button>}
      >
        <p className="mb-2 text-sm text-gray-600">這些日期已經有其他 payment 的資料，但沒有 Cash（O.CA）的紀錄。完全沒有資料的日期不需要填。缺少的日期：</p>
        <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
          {problems?.map((p) => (
            <li key={p.date} className="flex justify-between rounded bg-red-50 px-2 py-1">
              <span>{p.date}</span>
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
                await persist(true)
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
              （目前這間分店以畫面上的資料計算，其他分店以已儲存的資料計算）：
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
    </div>
  )
}
