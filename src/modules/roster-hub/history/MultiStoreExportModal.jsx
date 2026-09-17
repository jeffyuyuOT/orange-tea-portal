import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { exportMultiStoreWorkbook } from '../../../lib/excelRoster'
import { thisWeekStart } from '../shared/rosterWeeks'

export default function MultiStoreExportModal({ onClose }) {
  const { accessibleStores } = useAuth()
  const [selected, setSelected] = useState(accessibleStores.map((s) => s.id))
  const [weekStart, setWeekStart] = useState(thisWeekStart())
  const [busy, setBusy] = useState(false)

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function doExport() {
    setBusy(true)
    const storeSheets = []
    for (const storeId of selected) {
      const store = accessibleStores.find((s) => s.id === storeId)
      const { data: period } = await supabase
        .from('roster_periods')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', weekStart)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      let entries = []
      if (period) {
        const { data: rows } = await supabase
          .from('roster_entries')
          .select('*, profiles(email)')
          .eq('roster_period_id', period.id)
        entries = (rows ?? []).map((r) => ({
          staffEmail: r.profiles?.email ?? r.staff_name_raw ?? '',
          date: r.work_date,
          startTime: r.start_time?.slice(0, 5) ?? '',
          endTime: r.end_time?.slice(0, 5) ?? '',
          notes: r.notes ?? '',
        }))
      }
      storeSheets.push({ storeName: store?.name ?? storeId, entries })
    }
    exportMultiStoreWorkbook(storeSheets, `roster-${weekStart}-all-stores.xlsx`)
    setBusy(false)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Export multiple stores"
      footer={
        <Button onClick={doExport} disabled={busy || !selected.length}>
          {busy ? 'Exporting…' : 'Export'}
        </Button>
      }
    >
      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Week starting</span>
        <input type="date" className="input" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
      </label>
      <p className="mb-2 text-xs font-medium text-gray-500">Stores (one sheet each)</p>
      <div className="space-y-1">
        {accessibleStores.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
            {s.name}
          </label>
        ))}
      </div>
    </Modal>
  )
}
