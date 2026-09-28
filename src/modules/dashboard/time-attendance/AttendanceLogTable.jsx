import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { pairEventsIntoSessions, groupSessionsIntoCells, dailyTotals, formatMinutes } from '../../../lib/attendance'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Button from '../../../components/ui/Button'
import AttendanceCellEditModal from './AttendanceCellEditModal'
import AttendanceCellHistoryModal from './AttendanceCellHistoryModal'

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}
function daysAgoStr(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return format(d, 'yyyy-MM-dd')
}

function cellKey(date, storeId) {
  return `${date}|${storeId}`
}

// Shared by a person's own "Attendance Logs" tab (My Dashboard > Time &
// Attendance, canEdit always false — nobody edits their own punches) and
// Shop Management > Staff Time Logs (a manager/admin picks an employee;
// canEdit reflects that VIEWER's own permission — see StaffTimeLogsPage).
//
// Jeff, 2026-09: every store this person punches at shows up (not just
// whichever store the viewer currently has selected), each shift grouped
// into one box per (day, store) so break-separated in/out pairs at the
// same store sit together while the same day at a different store gets
// its own box — with a store filter (locked to that one store if the
// person only has one), and, when `canEdit`, the ability to correct/add
// punches with a required reason plus a visible edit history per box.
export default function AttendanceLogTable({ profileId, canEdit = false, editor = null, editorAccessibleStoreIds = null }) {
  const [from, setFrom] = useState(daysAgoStr(6)) // default: last 7 days, inclusive
  const [to, setTo] = useState(todayStr())
  const [events, setEvents] = useState([])
  const [edits, setEdits] = useState([])
  const [storeNames, setStoreNames] = useState({}) // id -> name
  const [assignedStores, setAssignedStores] = useState([]) // this PERSON's own stores, [{id, name}]
  const [storeFilter, setStoreFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [editingCell, setEditingCell] = useState(null) // { storeId, date, punches } | null
  const [addingRecord, setAddingRecord] = useState(false)
  const [historyCell, setHistoryCell] = useState(null) // { storeId, date } | null

  async function load() {
    setLoading(true)
    const [{ data: primaryRow }, { data: userStoreRows }, { data: eventRows }, { data: editRows }] = await Promise.all([
      supabase.from('profiles').select('primary_store_id').eq('id', profileId).single(),
      supabase.from('user_stores').select('store_id').eq('profile_id', profileId),
      supabase.from('attendance_events').select('*').eq('profile_id', profileId).order('occurred_at', { ascending: true }),
      supabase.from('attendance_event_edits').select('*').eq('profile_id', profileId).order('edited_at', { ascending: false }),
    ])
    const ownStoreIds = new Set()
    if (primaryRow?.primary_store_id) ownStoreIds.add(primaryRow.primary_store_id)
    ;(userStoreRows ?? []).forEach((r) => r.store_id && ownStoreIds.add(r.store_id))
    // Also pick up any store a punch/edit references that isn't among this
    // person's CURRENT assignments (e.g. they transferred stores since) —
    // so an old cell still gets a real store name instead of blank.
    ;(eventRows ?? []).forEach((e) => e.store_id && ownStoreIds.add(e.store_id))
    ;(editRows ?? []).forEach((e) => e.store_id && ownStoreIds.add(e.store_id))

    const ids = Array.from(ownStoreIds)
    const { data: storeRows } = ids.length ? await supabase.from('stores').select('id, name').in('id', ids) : { data: [] }
    const nameMap = {}
    ;(storeRows ?? []).forEach((s) => (nameMap[s.id] = s.name))
    setStoreNames(nameMap)
    // "Assigned" (for the filter's lock rule + the Add record store picker)
    // is deliberately just primary_store_id + user_stores — NOT every store
    // that ever shows up in punches/edits above, so a person who happens to
    // have one old punch from a store they've since left doesn't count as
    // "still belongs to 2 stores".
    const assignedIds = new Set()
    if (primaryRow?.primary_store_id) assignedIds.add(primaryRow.primary_store_id)
    ;(userStoreRows ?? []).forEach((r) => r.store_id && assignedIds.add(r.store_id))
    setAssignedStores(Array.from(assignedIds).map((id) => ({ id, name: nameMap[id] ?? '—' })))

    setEvents(eventRows ?? [])
    setEdits(editRows ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (profileId) load()
  }, [profileId])

  // Locked to that one store the moment there's only one to choose from —
  // whatever the filter was previously set to.
  useEffect(() => {
    if (assignedStores.length === 1) setStoreFilter(assignedStores[0].id)
  }, [assignedStores])

  if (loading) return <LoadingSpinner />

  const allSessions = pairEventsIntoSessions(events)
  const allCells = groupSessionsIntoCells(allSessions)
  const cells = allCells
    .filter((c) => c.date >= from && c.date <= to)
    .filter((c) => storeFilter === 'all' || c.storeId === storeFilter)
    .sort((a, b) => (b.date === a.date ? (storeNames[a.storeId] ?? '').localeCompare(storeNames[b.storeId] ?? '') : b.date.localeCompare(a.date)))

  const editsByCell = {}
  for (const e of edits) {
    const key = cellKey(e.event_date, e.store_id)
    if (!editsByCell[key]) editsByCell[key] = []
    editsByCell[key].push(e)
  }

  // Store options offered when adding a brand-new record: this person's
  // own stores, further narrowed to the viewing manager's own stores when
  // one was given (a shop_manager can only ever write punches at a store
  // they're assigned to — see migration 0062's RLS — admin/developer pass
  // editorAccessibleStoreIds=null, so no narrowing happens for them).
  const addableStores = editorAccessibleStoreIds
    ? assignedStores.filter((s) => editorAccessibleStoreIds.includes(s.id))
    : assignedStores

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">From</span>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} min={from} max={todayStr()} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Store</span>
          <select
            className="input w-auto"
            value={storeFilter}
            disabled={assignedStores.length <= 1}
            onChange={(e) => setStoreFilter(e.target.value)}
          >
            <option value="all">All stores</option>
            {assignedStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {canEdit && (
          <Button variant="secondary" className="ml-auto" onClick={() => setAddingRecord(true)} disabled={!addableStores.length}>
            + Add record
          </Button>
        )}
      </div>

      {!cells.length ? (
        <EmptyState label="No clock in/out records in this range." />
      ) : (
        <div className="space-y-3">
          {cells.map((cell) => {
            const key = cellKey(cell.date, cell.storeId)
            const cellEdits = editsByCell[key] ?? []
            const total = dailyTotals(cell.sessions)[cell.date]
            const punches = cell.sessions.flatMap((s) => [s.clockIn, s.clockOut].filter(Boolean))
            return (
              <div key={key} className="rounded-xl border border-brand-100 bg-white p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800">{format(parseISO(cell.date), 'EEE, MMM d yyyy')}</span>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      {storeNames[cell.storeId] ?? 'Unknown store'}
                    </span>
                    {!!cellEdits.length && (
                      <button
                        type="button"
                        onClick={() => setHistoryCell({ storeId: cell.storeId, date: cell.date })}
                        className="text-xs font-medium text-amber-600 hover:underline"
                      >
                        Edited
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-brand-700">Total: {formatMinutes(total)}</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setEditingCell({ storeId: cell.storeId, date: cell.date, punches })}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  {cell.sessions.map((s, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm text-gray-600">
                      <span>
                        {format(new Date(s.clockIn.occurred_at), 'h:mm a')} –{' '}
                        {s.clockOut ? format(new Date(s.clockOut.occurred_at), 'h:mm a') : 'still clocked in'}
                      </span>
                      <span className="text-gray-400">{s.inProgress ? 'In progress' : formatMinutes(s.minutes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editingCell && (
        <AttendanceCellEditModal
          profileId={profileId}
          storeId={editingCell.storeId}
          date={editingCell.date}
          punches={editingCell.punches}
          storeOptions={addableStores}
          editor={editor}
          onClose={() => setEditingCell(null)}
          onSaved={() => {
            setEditingCell(null)
            load()
          }}
        />
      )}
      {addingRecord && (
        <AttendanceCellEditModal
          profileId={profileId}
          storeId={null}
          date={null}
          punches={[]}
          storeOptions={addableStores}
          editor={editor}
          onClose={() => setAddingRecord(false)}
          onSaved={() => {
            setAddingRecord(false)
            load()
          }}
        />
      )}
      {historyCell && (
        <AttendanceCellHistoryModal
          edits={editsByCell[cellKey(historyCell.date, historyCell.storeId)] ?? []}
          storeName={storeNames[historyCell.storeId] ?? 'Unknown store'}
          date={historyCell.date}
          onClose={() => setHistoryCell(null)}
        />
      )}
    </div>
  )
}
