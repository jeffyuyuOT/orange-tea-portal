import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import RosterEntryGrid from './RosterEntryGrid'
import UnderstaffedWarnings from './UnderstaffedWarnings'
import ImportReconcileModal from './ImportReconcileModal'
import {
  downloadRosterTemplate,
  parseRosterGrid,
  exportRosterGrid,
  decimalToTime,
  timeToDecimal,
  rosterDisplayName,
  buildReconcilePlan,
  pendingAsStaff,
  pendingRosterName,
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
  // Set whenever the grid (from typing, "+ Add row", or an Excel upload)
  // has a name that doesn't match anyone known for this store even after
  // typo-tolerant matching — see handleUpload/persist/buildReconcilePlan.
  // `saveStatus` is set when this review was triggered by Save/Submit
  // (rather than by an upload), so confirming it also completes that save.
  const [importReview, setImportReview] = useState(null)

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
    // Who's "on" this store's roster — read from user_stores rather than
    // profiles.primary_store_id directly, so an admin (or manager) only
    // shows up in the store(s) they're actually assigned to in User
    // Management, instead of every store just because of their role. See
    // migration 0027's comment: user_stores is backfilled from
    // primary_store_id, so this covers everyone who was already showing up
    // the old way too.
    supabase
      .from('user_stores')
      .select('profiles(id, first_name, last_name, email, roster_display_name, is_active)')
      .eq('store_id', currentStoreId)
      .then(({ data }) => {
        const list = (data ?? []).map((r) => r.profiles).filter((p) => p && p.is_active)
        setStaff(list)
      })
    supabase
      .from('roster_pending_staff')
      .select('*')
      .eq('store_id', currentStoreId)
      .then(({ data }) => setPendingStaff(data ?? []))
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
        .select('*, profiles(first_name, last_name, roster_display_name)')
        .eq('roster_period_id', loadPeriodId)
      if (period) {
        setWeekStart(period.week_start_date)
        setNotes(period.notes ?? '')
      }
      setEntries(
        (rows ?? []).map((r) => ({
          profileId: r.profile_id ?? '',
          staffName: r.profiles ? rosterDisplayName(r.profiles) : r.staff_name_raw ?? '',
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
  // Pending staff show up in the downloadable template and "current grid"
  // export too, same as on-screen, so a not-yet-formal hire can be
  // scheduled ahead of time whichever way the roster gets filled in.
  const templateStaff = [...staff, ...pendingAsStaff(pendingStaff)]

  function knownNames() {
    return [
      ...staff.map((s) => ({ type: 'staff', id: s.id, name: rosterDisplayName(s) })),
      ...pendingStaff.map((p) => ({ type: 'pending', id: p.id, name: pendingRosterName(p) })),
    ]
  }

  // Applies a resolved plan (each item's `match` says who a raw name really
  // is) onto the parsed entries — shared by the no-review-needed path and
  // by confirmImport once the manager has answered for the 'new' ones.
  function applyPlan(parsed, plan) {
    const byRaw = Object.fromEntries(plan.filter((p) => p.match).map((p) => [p.rawName, p.match]))
    return parsed.map((e) => {
      if (e.profileId || !e.staffName) return e
      const m = byRaw[e.staffName]
      if (!m) return e
      return m.type === 'staff' ? { ...e, profileId: m.id, staffName: m.name } : { ...e, profileId: '', staffName: m.name }
    })
  }

  // Finds every name in `list` that isn't tied to a profile yet and isn't
  // already an exact/typo match for someone known — i.e. genuinely needs a
  // manager's confirmation before it's treated as a real person. Shared by
  // the upload path and the save path below, since both need the same
  // "is this actually a new person" check.
  function findsNeedingReview(list) {
    const rawNames = Array.from(new Set(list.filter((e) => !e.profileId && e.staffName).map((e) => e.staffName)))
    if (!rawNames.length) return null
    const known = knownNames()
    const plan = buildReconcilePlan(rawNames, known)
    const needsReview = plan.filter((p) => p.status === 'new')
    return { plan, known, needsReview }
  }

  async function handleUpload(file) {
    const parsed = await parseRosterGrid(file, staff, weekDates)
    // parseRosterGrid only matches against active staff — anything left
    // with no profileId either fuzzy-matches an existing name (typo,
    // auto-applied) or needs the manager to confirm it's genuinely new.
    const found = findsNeedingReview(parsed)
    if (!found) {
      setEntries(parsed)
      return
    }
    if (!found.needsReview.length) {
      setEntries(applyPlan(parsed, found.plan))
      return
    }
    setImportReview({ parsed, plan: found.plan, known: found.known })
  }

  // Confirms whichever names Save/Submit or an upload flagged as needing
  // review — inserts the ones confirmed as new into Pending staff, remaps
  // the rest to their chosen match, and (only when this review was
  // triggered by Save/Submit — see `saveStatus`) completes that save with
  // the now-resolved entries.
  async function confirmReview(choices) {
    const { parsed, plan, saveStatus } = importReview
    const known = knownNames()
    const newOnes = plan.filter((p) => p.status === 'new' && choices[p.rawName]?.mode === 'pending')
    let inserted = []
    if (newOnes.length) {
      const rows = newOnes.map((p) => ({ store_id: currentStoreId, display_name: (choices[p.rawName].name || p.rawName).trim() }))
      const { data } = await supabase.from('roster_pending_staff').insert(rows).select()
      inserted = data ?? []
    }
    let insertIdx = 0
    const resolvedPlan = plan.map((p) => {
      if (p.status !== 'new') return p
      const choice = choices[p.rawName]
      if (choice.mode === 'match') {
        const [type, id] = choice.matchKey.split(':')
        return { ...p, match: known.find((k) => k.type === type && k.id === id) ?? null }
      }
      const row = inserted[insertIdx++]
      return { ...p, match: row ? { type: 'pending', id: row.id, name: row.display_name } : null }
    })
    const finalEntries = applyPlan(parsed, resolvedPlan)
    setEntries(finalEntries)
    if (inserted.length) setPendingStaff((prev) => [...prev, ...inserted])
    setImportReview(null)
    if (saveStatus) await doPersist(saveStatus, finalEntries)
  }

  // The actual write — Save/Submit call this once there's nothing left
  // needing confirmation (either there never was, or confirmReview just
  // resolved it).
  async function doPersist(status, finalEntries) {
    setSaving(true)
    setMessage('')
    try {
      const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')
      // Upsert on (store_id, week_start_date) — Save/Submit used to insert a
      // fresh roster_periods row every click, so re-saving the same week
      // piled up near-duplicate drafts in History instead of updating the
      // one record for that week (see migration 0027).
      const { data: period, error } = await supabase
        .from('roster_periods')
        .upsert(
          {
            store_id: currentStoreId,
            week_start_date: weekStart,
            week_end_date: weekEnd,
            status,
            notes,
            created_by: profile.id,
            submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          },
          { onConflict: 'store_id,week_start_date' }
        )
        .select()
        .single()
      if (error) throw error

      // Replace this period's entries wholesale rather than trying to
      // diff/upsert per row — the grid may have added or removed rows
      // since the last save.
      const { error: deleteError } = await supabase.from('roster_entries').delete().eq('roster_period_id', period.id)
      if (deleteError) throw deleteError

      const rows = finalEntries
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

  // Save/Submit — either way, first check for any name on the grid (typed
  // by hand or left over from an upload) that isn't in User Management nor
  // already Pending staff, and pause on the same confirmation popup upload
  // uses before writing anything.
  async function persist(status) {
    const found = findsNeedingReview(entries)
    if (!found) {
      await doPersist(status, entries)
      return
    }
    if (!found.needsReview.length) {
      const resolved = applyPlan(entries, found.plan)
      setEntries(resolved)
      await doPersist(status, resolved)
      return
    }
    setImportReview({ parsed: entries, plan: found.plan, known: found.known, saveStatus: status })
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
        <Button variant="secondary" onClick={() => downloadRosterTemplate(storeName, templateStaff, weekDates, `roster-template-${weekStart}.xlsx`)}>
          Download template
        </Button>
        <label className="cursor-pointer rounded-lg border border-brand-300 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
          Upload Excel
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0])} />
        </label>
        <Button variant="secondary" onClick={() => exportRosterGrid(storeName, templateStaff, weekDates, entries, `roster-${weekStart}.xlsx`)}>
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
        <Button variant="secondary" disabled={saving || !!importReview} onClick={() => persist('draft')}>
          Save (not published)
        </Button>
        <Button disabled={saving || !!importReview} onClick={() => persist('submitted')}>
          Submit & Publish
        </Button>
      </div>
      {message && <p className="mt-2 text-sm text-brand-600">{message}</p>}

      {importReview && (
        <ImportReconcileModal
          items={importReview.plan.filter((p) => p.status === 'new')}
          known={importReview.known}
          onCancel={() => setImportReview(null)}
          onConfirm={confirmReview}
        />
      )}
    </div>
  )
}
