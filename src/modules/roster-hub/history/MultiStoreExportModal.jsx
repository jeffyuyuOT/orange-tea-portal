import { useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { exportMultiStoreWorkbook, timeToDecimal } from '../../../lib/excelRoster'
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
    const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd'))
    const storeSheets = []
    for (const storeId of selected) {
      const store = accessibleStores.find((s) => s.id === storeId)
      const [{ data: period }, { data: staffList }] = await Promise.all([
        supabase
          .from('roster_periods')
          .select('*')
          .eq('store_id', storeId)
          .eq('week_start_date', weekStart)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('profiles').select('id, first_name, last_name').eq('primary_store_id', storeId).eq('is_active', true),
      ])
      let entries = []
      if (period) {
        const { data: rows } = await supabase
          .from('roster_entries')
          .select('*, profiles(first_name, last_name)')
          .eq('roster_period_id', period.id)
        entries = (rows ?? []).map((r) => ({
          profileId: r.profile_id ?? '',
          staffName: r.profiles ? `${r.profiles.first_name ?? ''} ${r.profiles.last_name ?? ''}`.trim() : r.staff_name_raw ?? '',
          date: r.work_date,
          startTime: timeToDecimal(r.start_time),
          endTime: timeToDecimal(r.end_time),
          breakHours: r.break_half_hours ?? '',
        }))
      }
      storeSheets.push({ storeName: store?.name ?? storeId, staff: staffList ?? [], weekDates, entries })
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
