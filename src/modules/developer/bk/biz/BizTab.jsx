import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Badge from '../../../../components/ui/Badge'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { brisbaneToday, fmtMoney, isWeekend, monthDates, round2, weekdayOf } from '../bkUtils'
import { loadPublicHolidays, loadSalesMonth, loadSalesNotesMonth, loadSfPostMonth, saveSalesFields, saveSalesNote } from '../bkSalesData'
import { BIZ_INPUTS, bizDayRow, bizDaysFromRows, bizTotals, postMapFromRows } from '../bkSalesUtils'
import { Notice, StoreTabs, YearMonthPicker, inputCls } from '../bkUi'
import BizExportModal from './BizExportModal'
import BizOverview from './BizOverview'
import BizSummary from './BizSummary'

const OVERVIEW_ID = '__overview'
const SUMMARY_ID = '__summary'

const fmtCount = (n) => (n === null || n === undefined ? '' : round2(n).toLocaleString('en-AU', { maximumFractionDigits: 2 }))
const fmtAvgCount = (n) =>
  n === null || n === undefined ? '' : round2(n).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const th = 'border border-brand-100 px-1 py-1.5 text-[11px] font-semibold leading-tight text-gray-700'
const td = 'border border-gray-100 p-0'
// the heavier line between 日期 / 總營業額 / 總杯數 and the typed columns
const split = 'border-l-2 border-l-brand-300'

// 營業: each store's daily takings for one month. 總營業額 = POS + Self O +
// CV × 4 and 總杯數 = P杯數 + SO杯數 are computed; POS, CV, Self O and the two
// cup counts are typed — except POS for a store linked to SF, which is SF's
// O.POST. Self O also feeds that store's Self order kiosk column in SF.
export default function BizTab({ stores, topActive = true, onTabDirty, registerSaver }) {
  const today = brisbaneToday()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const [overview, setOverview] = useState(true) // 手動輸入總頁 is the first tab
  const [summary, setSummary] = useState(false) // 總覽 (read-only totals of every store)
  const [ovDirty, setOvDirty] = useState(false)
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)
  const [days, setDays] = useState({})
  const [postMap, setPostMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [exportMode, setExportMode] = useState(null) // 'excel' | 'week' | null
  const [notes, setNotes] = useState({}) // { [date]: note text } for the store + month on screen
  const [holidays, setHolidays] = useState({}) // { [date]: public holiday name } from the payroll app
  const [noteDate, setNoteDate] = useState(null) // the date whose note box is open
  const [noteDraft, setNoteDraft] = useState('')
  const [noteError, setNoteError] = useState('')

  const store = stores.find((s) => s.id === storeId) ?? stores[0] ?? null
  const linked = !!store?.sf_store_id
  const sfStoreId = store?.sf_store_id ?? null

  // The month's saved data. Changing store / month replaces whatever is on
  // screen (the change handlers below already asked about unsaved edits).
  useEffect(() => {
    if (!store || overview || summary) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setMsg('')
      try {
        const [rows, posts, noteRows] = await Promise.all([
          loadSalesMonth(store.id, year, month),
          sfStoreId ? loadSfPostMonth(sfStoreId, year, month) : Promise.resolve([]),
          loadSalesNotesMonth(store.id, year, month).catch(() => []), // notes are optional: never block the sheet
        ])
        if (cancelled) return
        setNotes(Object.fromEntries(noteRows.map((n) => [n.day, n.note])))
        setDays(bizDaysFromRows(rows))
        setPostMap(postMapFromRows(posts))
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
  }, [store?.id, sfStoreId, year, month, overview, summary]) // eslint-disable-line react-hooks/exhaustive-deps

  // Public holidays come from the payroll app's stores; read once (and again when coming back to this tab).
  useEffect(() => {
    if (!topActive) return
    let cancelled = false
    loadPublicHolidays()
      .then((m) => !cancelled && setHolidays(m))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [topActive])

  function openNote(date) {
    setNoteDate(date)
    setNoteDraft(notes[date] ?? '')
    setNoteError('')
  }
  async function saveNote(text) {
    try {
      await saveSalesNote(store.id, noteDate, text)
      const t = text.trim()
      setNotes((prev) => {
        const next = { ...prev }
        if (t) next[noteDate] = t
        else delete next[noteDate]
        return next
      })
      setNoteDate(null)
    } catch (e) {
      setNoteError(e.message)
    }
  }

  // SF's O.POST can change while this tab is hidden — re-read it when coming back.
  useEffect(() => {
    if (!topActive || !sfStoreId || overview || summary) return
    let cancelled = false
    loadSfPostMonth(sfStoreId, year, month)
      .then((rows) => !cancelled && setPostMap(postMapFromRows(rows)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [topActive, sfStoreId, year, month, overview, summary])


  const dates = useMemo(() => monthDates(year, month), [year, month])
  const rows = useMemo(
    () => dates.map((date) => ({ date, ...bizDayRow(days[date], linked ? (postMap[date] ?? null) : undefined) })),
    [dates, days, postMap, linked]
  )
  const { total, average } = useMemo(() => bizTotals(rows), [rows])

  async function save() {
    setSaving(true)
    setError('')
    setMsg('')
    try {
      await saveSalesFields(store.id, days, ['pos'])
      setDirty(false)
      setMsg('已儲存。')
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  // BK's 儲存 button: report whether anything here is unsaved, and save the
  // store sheet (POS) and the 手動輸入總頁 together.
  const ovSaveRef = useRef(null)
  const onOvSaveReady = useCallback((fn) => {
    ovSaveRef.current = fn
  }, [])
  const stateRef = useRef({})
  stateRef.current = { dirty, ovDirty, save }
  useEffect(() => {
    onTabDirty?.(dirty || ovDirty)
  }, [dirty, ovDirty]) // eslint-disable-line react-hooks/exhaustive-deps
  // The save used by BK's 儲存 button AND when leaving a store / month: typing
  // is saved instead of asking whether to throw it away (→ true / false).
  const saveAllHere = useCallback(async () => {
    const cur = stateRef.current
    let ok = true
    if (cur.ovDirty && ovSaveRef.current) ok = (await ovSaveRef.current()) && ok
    if (cur.dirty) ok = (await cur.save()) && ok
    return ok
  }, [])
  useEffect(() => {
    registerSaver?.('biz', saveAllHere)
  }, [registerSaver, saveAllHere])

  if (!store) {
    return (
      <Notice kind="info">還沒有任何營業分店。請先到 系統設置 › 營業 › 分店管理 新增分店。</Notice>
    )
  }

  const status = dirty ? { color: 'brand', text: '有未儲存的變更' } : null
  const moneyCell = (v) => <div className="px-1 py-1 text-right tabular-nums text-gray-700">{fmtMoney(v)}</div>

  return (
    <div className="space-y-3">
      <StoreTabs
        stores={stores}
        storeId={overview ? OVERVIEW_ID : summary ? SUMMARY_ID : store.id}
        lead={[
          [OVERVIEW_ID, '手動輸入總頁'],
          [SUMMARY_ID, '總覽'],
        ]}
        onChange={async (id) => {
          if (id === OVERVIEW_ID) {
            if (!overview && (await saveAllHere())) {
              setOverview(true)
              setSummary(false)
            }
          } else if (id === SUMMARY_ID) {
            if (!summary && (await saveAllHere())) {
              setSummary(true)
              setOverview(false)
            }
          } else if ((overview || summary || id !== store.id) && (await saveAllHere())) {
            setStoreId(id)
            setOverview(false)
            setSummary(false)
          }
        }}
      />

      {overview && (
        <BizOverview
          stores={stores}
          year={year}
          month={month}
          onYearMonth={async (v) => {
            if (await saveAllHere()) {
              setYear(v.year)
              setMonth(v.month)
            }
          }}
          onDirtyChange={setOvDirty}
          onSaveReady={onOvSaveReady}
        />
      )}

      {summary && (
        <BizSummary
          stores={stores}
          holidays={holidays}
          year={year}
          month={month}
          onYearMonth={(v) => {
            setYear(v.year)
            setMonth(v.month)
          }}
        />
      )}

      {!overview && !summary && (<>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-brand-900">{store.name}</span>
        <YearMonthPicker
          year={year}
          month={month}
          onChange={async (v) => {
            if (await saveAllHere()) {
              setYear(v.year)
              setMonth(v.month)
            }
          }}
        />
        {status && <Badge color={status.color}>{status.text}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Button variant="secondary" onClick={() => setMenuOpen((v) => !v)}>
              匯出 ▾
            </Button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-lg border border-brand-100 bg-white shadow-lg">
                {[
                  ['excel', 'Excel 匯出'],
                  ['week', '週匯出'],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      setExportMode(mode)
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {linked && (
        <Notice kind="info">
          這間分店的 POS 直接讀 Sales figure 的 O.POST（不能在這裡改）。Self O 是 Sales figure 的 Self order kiosk 的預設值；SF 那邊可以手動改，兩邊不一致時 SF 會顯示警示。
        </Notice>
      )}
      <Notice kind="info">
        {linked
          ? 'P杯數、CV、Self O、SO杯數 請到「手動輸入總頁」輸入，這裡只顯示那邊的數字。'
          : 'P杯數、POS、CV、Self O、SO杯數 請到「手動輸入總頁」輸入，這裡只顯示那邊的數字。'}
      </Notice>
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-brand-100">
          <table className="w-full table-fixed border-collapse text-[13px]" style={{ minWidth: 740 }}>
            <colgroup>
              <col style={{ width: 90 }} />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <th className={`${th} sticky left-0 z-30 bg-brand-100 text-left`}>日期</th>
                <th className={`${th} bg-brand-100`}>
                  總營業額
                  <div className="text-[10px] font-normal text-gray-500">= POS + Self O + CV×4</div>
                </th>
                <th className={`${th} bg-brand-100`}>
                  總杯數
                  <div className="text-[10px] font-normal text-gray-500">= P杯數 + SO杯數</div>
                </th>
                {BIZ_INPUTS.map(({ key, label }, i) => (
                  <th key={key} className={`${th} bg-sky-50 ${i === 0 ? split : ''}`}>
                    {label}
                    {key === 'pos' && linked && <div className="text-[10px] font-normal text-gray-500">SF 的 O.POST</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => {
                const r = rows[i]
                const day = days[date] ?? {}
                const holiday = holidays[date]
                const weekendBg = holiday ? 'bg-rose-50' : isWeekend(date) ? 'bg-gray-50' : 'bg-white'
                return (
                  <tr key={date} className={weekendBg}>
                    <td className={`${td} sticky left-0 z-10 whitespace-nowrap ${weekendBg}`}>
                      <button
                        type="button"
                        onClick={() => openNote(date)}
                        className="flex w-full items-center gap-1 px-1.5 py-1 text-left hover:bg-brand-50"
                        title={[holiday && `Public holiday：${holiday}`, notes[date]].filter(Boolean).join('\n') || '點擊新增附註'}
                      >
                        <span className="font-medium">{Number(date.slice(8))}</span>
                        <span className="text-[11px] text-gray-400">{weekdayOf(date)}</span>
                        {holiday && <span className="text-[12px]">🎉</span>}
                        {notes[date] && <span className="text-[12px]">📝</span>}
                      </button>
                    </td>
                    <td className={td}>
                      <div className="px-1 py-1 text-right font-medium tabular-nums text-gray-700" title="POS + Self O + CV × 4">
                        {fmtMoney(r.total)}
                      </div>
                    </td>
                    <td className={td}>
                      <div className="px-1 py-1 text-right font-medium tabular-nums text-gray-700" title="P杯數 + SO杯數">
                        {fmtCount(r.cups)}
                      </div>
                    </td>
                    {BIZ_INPUTS.map(({ key, field, money }, c) => (
                      <td key={key} className={`${td} bg-sky-50/40 ${c === 0 ? split : ''}`}>
                        <div
                          className="px-1 py-1 text-right tabular-nums text-gray-700"
                          title={key === 'pos' && linked ? '來自 Sales figure 的 O.POST' : '在手動輸入總頁輸入'}
                        >
                          {money ? fmtMoney(r[key]) : fmtCount(r[key])}
                        </div>
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              {[
                ['Total', total, fmtCount],
                ['平均', average, fmtAvgCount],
              ].map(([label, src, countFmt]) => (
                <tr key={label} className="bg-brand-50 font-semibold">
                  <td className={`${td} sticky left-0 z-30 bg-brand-50 px-1.5 py-1.5`} title={label === '平均' ? '用這個月已有資料的天數算每日平均' : undefined}>
                    {label}
                  </td>
                  <td className={td}>{moneyCell(src.total)}</td>
                  <td className={td}>
                    <div className="px-1 py-1 text-right tabular-nums">{countFmt(src.cups)}</div>
                  </td>
                  {BIZ_INPUTS.map(({ key, money }, c) => (
                    <td key={key} className={`${td} ${c === 0 ? split : ''}`}>
                      {money ? moneyCell(src[key]) : <div className="px-1 py-1 text-right tabular-nums">{countFmt(src[key])}</div>}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}

      </>)}

      <Modal
        open={!!noteDate}
        onClose={() => setNoteDate(null)}
        title={noteDate ? `${store.name} · ${noteDate} ${weekdayOf(noteDate)} 附註` : ''}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {noteDate && notes[noteDate] && (
                <Button variant="secondary" onClick={() => saveNote('')}>
                  刪除附註
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setNoteDate(null)}>
                取消
              </Button>
              <Button onClick={() => saveNote(noteDraft)}>儲存</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {noteDate && holidays[noteDate] && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">🎉 Public holiday：{holidays[noteDate]}</div>
          )}
          <textarea
            className={`${inputCls} w-full`}
            rows={4}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="這一天的附註（例如活動、天氣、特別事件）"
            autoFocus
          />
          <p className="text-xs text-gray-400">相同文字的附註，會在 歷史紀錄 › 營業 › Event 裡跨年份對照。</p>
          {noteError && <Notice kind="error" onClose={() => setNoteError('')}>{noteError}</Notice>}
        </div>
      </Modal>

      <BizExportModal open={!!exportMode} mode={exportMode ?? 'excel'} stores={stores} year={year} month={month} onClose={() => setExportMode(null)} />
    </div>
  )
}
