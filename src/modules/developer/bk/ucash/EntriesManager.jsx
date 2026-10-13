import { useCallback, useEffect, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../../components/ui/LoadingSpinner'
import { ENTRY_KIND_LABELS, RUJU_TARGET_LABELS, brisbaneToday, dwSigned, fmtMoney, monthStart, nextMonthStart, ymd } from '../bkUtils'
import { deleteEntry, listEntries } from '../bkData'
import { NoteButton, Notice, StoreTabs, inputCls } from '../bkUi'
import EntryForm from './EntryForm'

const KIND_FILTERS = [
  ['', '全部種類'],
  ['icost', 'Icost'],
  ['ucost', 'Ucost'],
  ['other_income', '其他收入'],
  ['dw', 'deposit / withdraw'],
  ['ruju', '入金'],
]
const kindsFor = (filter) => (filter === 'dw' ? ['deposit', 'withdraw'] : filter ? [filter] : null)

function lastDayOfMonthStr(year, month) {
  const next = nextMonthStart(year, month)
  const d = new Date(`${next}T00:00:00Z`)
  d.setUTCDate(0)
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

// 新增編輯收支: add a new entry, or list existing ones (this month by default,
// filterable by date range and kind) to edit or delete. Whatever is saved here
// shows up in 分店現金 straight away.
export default function EntriesManager({ stores, store, onNavigate, onEntriesChanged }) {
  const t = brisbaneToday()
  const [mode, setMode] = useState('edit') // 'add' | 'edit'
  const [from, setFrom] = useState(monthStart(t.year, t.month))
  const [to, setTo] = useState(lastDayOfMonthStr(t.year, t.month))
  const [kindFilter, setKindFilter] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [noteText, setNoteText] = useState(null)
  const [formKey, setFormKey] = useState(0)
  const [saved, setSaved] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await listEntries({ storeId: store.id, from, to, kinds: kindsFor(kindFilter) }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [store.id, from, to, kindFilter])

  useEffect(() => {
    if (mode === 'edit') reload()
  }, [mode, reload])

  async function remove(entry) {
    const label = `${entry.entry_date} ${ENTRY_KIND_LABELS[entry.kind]} ${fmtMoney(Number(entry.amount))}`
    if (!window.confirm(`確定刪除這筆收支？\n${label}`)) return
    try {
      await deleteEntry(entry.id)
      await reload()
      onEntriesChanged?.()
    } catch (e) {
      setError(e.message)
    }
  }

  const describe = (e) => {
    if (e.kind === 'icost' || e.kind === 'ucost' || e.kind === 'other_income') return e.description
    if (e.kind === 'ruju') return RUJU_TARGET_LABELS[e.ruju_target]
    return ''
  }
  const signed = (e) => (e.kind === 'withdraw' || e.kind === 'deposit' ? dwSigned(e) : Number(e.amount))

  return (
    <div className="space-y-4">
      <StoreTabs stores={stores} storeId={store.id} onChange={(id) => onNavigate({ storeId: id })} />
      <div className="flex gap-2">
        {[
          ['add', '新增收支'],
          ['edit', '編輯現有收支'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setMode(k)
              setSaved(false)
            }}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${
              mode === k ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

      {mode === 'add' ? (
        <div className="max-w-md space-y-3 rounded-xl border border-brand-100 bg-white p-4">
          <div className="text-sm font-semibold text-brand-900">新增收支 — {store.name}</div>
          {saved && <Notice kind="ok" onClose={() => setSaved(false)}>已新增，並同步到分店現金。</Notice>}
          <EntryForm
            key={formKey}
            storeId={store.id}
            onSaved={() => {
              setSaved(true)
              setFormKey((k) => k + 1)
              onEntriesChanged?.()
            }}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              從
              <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              到
              <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <select className={inputCls} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Kind">
              {KIND_FILTERS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <LoadingSpinner />
          ) : rows.length === 0 ? (
            <EmptyState label="這個範圍沒有收支紀錄。" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-brand-100">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-100 text-left text-xs text-gray-700">
                  <tr>
                    <th className="px-3 py-2">日期</th>
                    <th className="px-3 py-2">種類</th>
                    <th className="px-3 py-2">Description / 對象</th>
                    <th className="px-3 py-2 text-right">金額</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-2">{e.entry_date}</td>
                      <td className="px-3 py-2">{ENTRY_KIND_LABELS[e.kind]}</td>
                      <td className="px-3 py-2">
                        {describe(e)}
                        <NoteButton note={e.note} onOpen={setNoteText} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(signed(e))}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => setEditing(e)}>
                            編輯
                          </Button>
                          <Button variant="danger" onClick={() => remove(e)}>
                            刪除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="編輯收支">
        {editing && (
          <EntryForm
            storeId={store.id}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null)
              await reload()
              onEntriesChanged?.()
            }}
          />
        )}
      </Modal>
      <Modal open={noteText !== null} onClose={() => setNoteText(null)} title="附註" footer={<Button onClick={() => setNoteText(null)}>關閉</Button>}>
        <p className="whitespace-pre-wrap text-sm text-gray-700">{noteText}</p>
      </Modal>
    </div>
  )
}
