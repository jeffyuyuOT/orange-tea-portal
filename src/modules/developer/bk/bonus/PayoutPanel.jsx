import { useMemo, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { deletePayout } from '../bkDividendData'
import { Notice, inputCls } from '../bkUi'
import { EventEditor, EventTable, NoteModal, PayoutForm, StatCard } from './bonusParts'
import { SettlementModal } from './SettlementParts'
import DividendExcelImport from './DividendExcelImport'

// 分紅記錄: all-time figures per party (總共 / 已領取 / 可領) and the payouts
// made to each, filterable by date and method.
export default function PayoutPanel({ view }) {
  const { combined: c, stores, storeId, storeNames, partyNames, data, reload, storesInView } = view
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [method, setMethod] = useState('')
  const [adding, setAdding] = useState(null) // null | 'choose' | 'payout' | 'settle'
  const [editing, setEditing] = useState(null)
  const [note, setNote] = useState(null)
  const [error, setError] = useState('')
  const [importFile, setImportFile] = useState(null)
  const [importedMsg, setImportedMsg] = useState('')
  const fileInputRef = useRef(null)

  const payouts = useMemo(() => c.events.filter((ev) => ev.type === 'payout'), [c.events])
  const passes = (ev) => (!from || ev.date >= from) && (!to || ev.date <= to) && (!method || ev.method === method)

  async function remove(ev) {
    try {
      await deletePayout(ev.id)
      setEditing(null)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {importedMsg && <Notice kind="ok" onClose={() => setImportedMsg('')}>{importedMsg}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            從
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            到
            <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="方式">
            <option value="">全部方式</option>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            匯入 Excel
          </Button>
          <Button onClick={() => setAdding('choose')} disabled={data.parties.length === 0}>
            ＋ 新增
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) setImportFile(f)
        }}
      />
      {importFile && (
        <DividendExcelImport
          file={importFile}
          stores={stores}
          data={data}
          onClose={() => setImportFile(null)}
          onImported={async (count) => {
            setImportFile(null)
            setImportedMsg(`已匯入 ${count} 筆。`)
            await reload()
          }}
        />
      )}
      <p className="text-xs text-gray-500">這裡是從開始到現在的全部資料（不受分紅完全結算影響）。總共分紅 = (所有入金 − Cost) × 加權；可領分紅 = 總共分紅 − 已領取分紅。</p>
      {data.parties.length === 0 && <Notice kind="info">還沒有設定任何 party。請先到「設定」新增。</Notice>}

      {c.allTimeParties.map((p) => {
        const rows = payouts.filter((ev) => p.partyIds.includes(ev.partyId) && passes(ev)).reverse()
        return (
          <section key={p.key} className="space-y-2 rounded-xl border border-brand-100 bg-white p-4">
            <div className="text-base font-semibold text-brand-900">{p.name}</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="可領分紅" value={p.claimable} />
              <StatCard label="已領取分紅" value={p.paid} />
              <StatCard label="總共分紅" value={p.total} />
            </div>
            <EventTable
              events={rows}
              storeNames={storeNames}
              showStore={storesInView.length > 1}
              partyNames={partyNames}
              fullKeys={c.fullKeys}
              onNote={setNote}
              onOpen={setEditing}
            />
          </section>
        )
      })}

      <Modal open={adding === 'choose'} onClose={() => setAdding(null)} title="新增">
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setAdding('payout')} className="rounded-xl border border-brand-200 p-4 text-left hover:bg-brand-50">
            <div className="font-semibold text-brand-800">分紅紀錄</div>
            <div className="mt-1 text-xs text-gray-500">記錄某個 party 領了多少分紅（Bank 從 Jeff B 扣、Cash 從 Mao保 扣）。</div>
          </button>
          <button type="button" onClick={() => setAdding('settle')} className="rounded-xl border border-brand-200 p-4 text-left hover:bg-brand-50">
            <div className="font-semibold text-brand-800">分紅結算紀錄</div>
            <div className="mt-1 text-xs text-gray-500">對照每個 party 的可領取分紅和擁有的金庫資產，只供參考，不改數據。</div>
          </button>
        </div>
      </Modal>
      <Modal open={adding === 'payout'} onClose={() => setAdding(null)} title="新增分紅紀錄">
        <PayoutForm
          stores={stores}
          storeId={storeId}
          parties={data.parties}
          onCancel={() => setAdding(null)}
          onSaved={async () => {
            setAdding(null)
            await reload()
          }}
        />
      </Modal>
      {adding === 'settle' && (
        <SettlementModal
          open
          view={view}
          onClose={() => setAdding(null)}
          onSaved={async () => {
            setAdding(null)
            await reload()
          }}
        />
      )}
      <EventEditor
        ev={editing}
        stores={stores}
        parties={data.parties}
        onClose={() => setEditing(null)}
        onChanged={async () => {
          setEditing(null)
          await reload()
        }}
        onDelete={remove}
      />
      <NoteModal note={note} onClose={() => setNote(null)} />
    </div>
  )
}
