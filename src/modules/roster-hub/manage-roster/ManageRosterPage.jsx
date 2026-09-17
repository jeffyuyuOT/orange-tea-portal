import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import RosterEntryGrid from './RosterEntryGrid'
import UnderstaffedWarnings from './UnderstaffedWarnings'
import { downloadRosterTemplate, parseRosterFile, exportRosterWorkbook } from '../../../lib/excelRoster'

export default function ManageRosterPage() {
  const { currentStoreId, profile } = useAuth()
  const location = useLocation()
  const [weekStart, setWeekStart] = useState('')
  const [entries, setEntries] = useState([])
  const [notes, setNotes] = useState('')
  const [staff, setStaff] = useState([])
  const [rules, setRules] = useState([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

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
        .select('*, profiles(email)')
        .eq('roster_period_id', loadPeriodId)
      if (period) {
        setWeekStart(period.week_start_date)
        setNotes(period.notes ?? '')
      }
      setEntries(
        (rows ?? []).map((r) => ({
          profileId: r.profile_id ?? '',
          staffEmail: r.profiles?.email ?? r.staff_name_raw ?? '',
          date: r.work_date,
          startTime: r.start_time?.slice(0, 5) ?? '',
          endTime: r.end_time?.slice(0, 5) ?? '',
          notes: r.notes ?? '',
        }))
      )
    })()
  }, [location.state])

  const weekDates = weekStart ? Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd')) : []

  async function handleUpload(file) {
    const parsed = await parseRosterFile(file)
    const byEmail = new Map(staff.map((s) => [s.email?.toLowerCase(), s]))
    setEntries(
      parsed.map((p) => {
        const match = byEmail.get(p.staffEmail.toLowerCase())
        return {
          profileId: match?.id ?? '',
          staffEmail: p.staffEmail,
          date: p.date,
          startTime: p.startTime,
          endTime: p.endTime,
          notes: p.notes,
        }
      })
    )
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
        .filter((e) => e.date && e.startTime && e.endTime)
        .map((e) => ({
          roster_period_id: period.id,
          profile_id: e.profileId || null,
          staff_name_raw: e.staffEmail,
          work_date: e.date,
          start_time: e.startTime,
          end_time: e.endTime,
          notes: e.notes,
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
      <p className="mb-4 text-sm text-gray-500">Upload the fixed Excel template, or edit shifts directly below.</p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Week starting (Mon)</span>
          <input type="date" className="input" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </label>
        <Button variant="secondary" onClick={() => downloadRosterTemplate(staff, weekDates)}>
          Download template
        </Button>
        <label className="cursor-pointer rounded-lg border border-brand-300 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
          Upload Excel
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0])} />
        </label>
        <Button
          variant="secondary"
          onClick={() =>
            exportRosterWorkbook(entries, `roster-${weekStart}.xlsx`)
          }
        >
          Export current grid
        </Button>
      </div>

      <RosterEntryGrid entries={entries} setEntries={setEntries} staff={staff} />
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
