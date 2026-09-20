import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import RosterEntryGrid from './RosterEntryGrid'
import UnderstaffedWarnings from './UnderstaffedWarnings'
import {
  downloadRosterTemplate,
  parseRosterGrid,
  exportRosterGrid,
  decimalToTime,
  timeToDecimal,
} from '../../../lib/excelRoster'

export default function ManageRosterPage() {
  const { currentStoreId, accessibleStores, profile } = useAuth()
  const location = useLocation()
  const [weekStart, setWeekStart] = useState('')
  const [entries, setEntries] = useState([])
  const [notes, setNotes] = useState('')
  const [staff, setStaff] = useState([])
  const [pendingStaff, setPendingStaff] = useState([])
  const [rules, setRules] = useState([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? ''

  // Default: the week after the most recently saved period for this store.
  useEffect(() => {
    if (!currentStoreId) return
    supabase
      .from('roster_periods')
      .select('week_start_date')
      .eq('store_id', currentStoreId)
      .order('week_start_date', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const base = data ? addDays(parseISO(data.week_start_date), 7) : new Date()
        setWeekStart(format(base, 'yyyy-MM-dd'))
      })
    supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('primary_store_id', currentStoreId)
      .eq('is_active', true)
      .then(({ data }) => setStaff(data ?? []))
    // Placeholder staff created in User Management (no login yet) — they
    // show up as pre-named rows in the grid below, same as a casual/one-off
    // name typed in by hand, until they're linked to a real account.
    supabase
      .from('pending_staff')
      .select('id, first_name, last_name')
      .eq('primary_store_id', currentStoreId)
      .is('linked_profile_id', null)
      .then(({ data }) =>
        setPendingStaff((data ?? []).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name ?? ''}`.trim() })))
      )
    supabase
      .from('roster_staffing_rules')
      .select('*')
      .eq('store_id', currentStoreId)
      .then(({ data }) => setRules(data ?? []))
  }, [currentStoreId])

  // "Load" a period passed via History page navigation state.
  useEffect(() => {
    const loadPeriodId = location.state?.loadPeriodId
    if (!loadPeriodId) return
    ;(async () => {
      const { data: period } = await supabase.from('roster_periods').select('*').eq('id', loadPeriodId).single()
      const { data: rows } = await supabase
        .from('roster_entries')
        .select('*, profiles(first_name, last_name)')
        .eq('roster_period_id', loadPeriodId)
      if (period) {
        setWeekStart(period.week_start_date)
        setNotes(period.notes ?? '')
      }
      setEntries(
        (rows ?? []).map((r) => ({
          profileId: r.profile_id ?? '',
          staffName: r.profiles ? `${r.profiles.first_name ?? ''} ${r.profiles.last_name ?? ''}`.trim() : r.staff_name_raw ?? '',
          date: r.work_date,
          startTime: timeToDecimal(r.start_time),
          endTime: timeToDecimal(r.end_time),
          breakHours: r.break_half_hours ?? '',
          notes: r.notes ?? '',
        }))
      )
    })()
  }, [location.state])

  const weekDates = weekStart ? Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd')) : []

  async function handleUpload(file) {
    const parsed = await parseRosterGrid(file, staff, weekDates)
    setEntries(parsed)
  }

  async function persist(status) {
    setSaving(true)
    setMessage('')
    try {
      const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')
      const { data: period, error } = await supabase
        .from('roster_periods')
        .insert({
          store_id: currentStoreId,
          week_start_date: weekStart,
          week_end_date: weekEnd,
          status,
          notes,
          created_by: profile.id,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        })
        .select()
        .single()
      if (error) throw error

      const rows = entries
        .filter((e) => e.date && e.startTime !== '' && e.endTime !== '')
        .map((e) => ({
          roster_period_id: period.id,
          profile_id: e.profileId || null,
          staff_name_raw: e.staffName,
          work_date: e.date,
          start_time: decimalToTime(e.startTime),
          end_time: decimalToTime(e.endTime),
          break_half_hours: e.breakHours === '' || e.breakHours == null ? null : e.breakHours,
          notes: e.notes || null,
        }))
      if (rows.length) {
        const { error: entriesError } = await supabase.from('roster_entries').insert(rows)
        if (entriesError) throw entriesError
      }
      setMessage(status === 'submitted' ? 'Roster submitted and published.' : 'Roster saved as draft.')
    } catch (err) {
      setMessage(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Manage Roster</h1>
      <p className="mb-4 text-sm text-gray-500">
        Fill in the grid below — Start/End hours (e.g. 11, 22.5 for 10:30pm) and each day's Break in half-hour units
        (1 = 30 min, 2 = 1 hr) — or download the template, fill it in Excel, and upload it back. Total hr and WKD hr
        are calculated automatically.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Week starting (Mon)</span>
          <input type="date" className="input" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </label>
        <Button variant="secondary" onClick={() => downloadRosterTemplate(storeName, staff, weekDates, `roster-template-${weekStart}.xlsx`)}>
          Download template
        </Button>
        <label className="cursor-pointer rounded-lg border border-brand-300 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
          Upload Excel
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0])} />
        </label>
        <Button variant="secondary" onClick={() => exportRosterGrid(storeName, staff, weekDates, entries, `roster-${weekStart}.xlsx`)}>
          Export current grid
        </Button>
      </div>

      <RosterEntryGrid staff={staff} pendingStaff={pendingStaff} weekDates={weekDates} entries={entries} setEntries={setEntries} />
      <UnderstaffedWarnings entries={entries} rules={rules} />

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Notes</span>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" disabled={saving} onClick={() => persist('draft')}>
          Save (not published)
        </Button>
        <Button disabled={saving} onClick={() => persist('submitted')}>
          Submit & Publish
        </Button>
      </div>
      {message && <p className="mt-2 text-sm text-brand-600">{message}</p>}
    </div>
  )
}
