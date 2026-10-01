import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import {
  pairEventsIntoSessions,
  groupSessionsIntoCells,
  dailyTotals,
  formatMinutes,
  getAttendanceDayBreaks,
  breakMinutesFromHalfHours,
  formatBreakUnits,
} from '../../../lib/attendance'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Button from '../../../components/ui/Button'
import AttendanceCellEditModal from './AttendanceCellEditModal'

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
export default function AttendanceLogTable({
  profileId,
  canEdit = false,
  editor = null,
  editorAccessibleStoreIds = null,
  currentStoreId = null,
}) {
  const [from, setFrom] = useState(daysAgoStr(6)) // default: last 7 days, inclusive
  const [to, setTo] = useState(todayStr())
  const [events, setEvents] = useState([])
  const [edits, setEdits] = useState([])
  const [breaks, setBreaks] = useState([])
  const [storeNames, setStoreNames] = useState({}) // id -> name
  const [assignedStores, setAssignedStores] = useState([]) // this PERSON's own stores, [{id, name}]
  const [storeFilter, setStoreFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [editingCell, setEditingCell] = useState(null) // { storeId, date, punches, breakHalfHours } | null
  const [addingRecord, setAddingRecord] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: primaryRow }, { data: userStoreRows }, { data: eventRows }, { data: editRows }, breakRows] = await Promise.all([
      supabase.from('profiles').select('primary_store_id').eq('id', profileId).single(),
      supabase.from('user_stores').select('store_id').eq('profile_id', profileId),
      supabase.from('attendance_events').select('*').eq('profile_id', profileId).order('occurred_at', { ascending: true }),
      supabase.from('attendance_event_edits').select('*').eq('profile_id', profileId).order('edited_at', { ascending: false }),
      getAttendanceDayBreaks(profileId),
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
    setBreaks(breakRows ?? [])
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

  // One row per cell, if a break's ever been logged for it — keyed the
  // same way as editsByCell above.
  const breaksByCell = {}
  for (const b of breaks) {
    breaksByCell[cellKey(b.event_date, b.store_id)] = b
  }

  // Jeff, 2026-10-02: "add attendance record時，不用選擇店面" — a new
  // record is always written at `currentStoreId` now (no Store picker in
  // the modal any more), so the only thing left to guard here is that
  // there IS a current store, and — for a shop_manager, who can only ever
  // write punches at a store they're themselves assigned to (migration
  // 0062's RLS) — that it's actually one of theirs. admin/developer pass
  // editorAccessibleStoreIds=null, so no narrowing applies to them.
  const canAddAtCurrentStore =
    !!currentStoreId && (editorAccessibleStoreIds == null || editorAccessibleStoreIds.includes(currentStoreId))

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
          <Button variant="secondary" className="ml-auto" onClick={() => setAddingRecord(true)} disabled={!canAddAtCurrentStore}>
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
            const breakRow = breaksByCell[key]
            const breakMinutes = breakRow ? breakMinutesFromHalfHours(breakRow.break_half_hours) : 0
            const rawTotal = dailyTotals(cell.sessions)[cell.date]
            const total = rawTotal == null ? null : Math.max(0, rawTotal - breakMinutes)
            const punches = cell.sessions.flatMap((s) => [s.clockIn, s.clockOut].filter(Boolean))
            const storeName = storeNames[cell.storeId] ?? 'Unknown store'
            // Jeff, 2026-09-30: "如果有經過manager或admin編輯時間，原本的
            // edit放在被編輯的時間段後面，如果同一天有多段時間被編輯，每一段
            // 後面都要放edit" -- attendance_event_edits rows carry the
            // punch's own event_id (migration 0062), so match each edit to
            // whichever session it belongs to and render that session's own
            // "edit at …" note right next to it, instead of one combined
            // note for the whole day. Jeff, 2026-10-02: "後面顯示edit at編輯
            // 日期時間，但其實不需要edit history視窗" -- plain inline text
            // now, not a link that opens a modal; "by <who>" is only part
            // of it for a viewer with canEdit (same gate as the Edit button
            // itself — "有勾edit attendance time權限的和admin跟developer可以
            // 看到...by誰"). A DELETED punch's edit row has event_id nulled
            // out (FK "on delete set null"), so it can never match a
            // currently-visible session; those are listed as their own
            // inline lines below the sessions instead.
            const matchedEditIds = new Set()
            const sessionEditsFor = (s) => {
              const rows = cellEdits.filter(
                (e) => e.event_id && (e.event_id === s.clockIn?.id || e.event_id === s.clockOut?.id)
              )
              rows.forEach((e) => matchedEditIds.add(e.id))
              return rows
            }
            const sessionEditsList = cell.sessions.map(sessionEditsFor)
            const unmatchedEdits = cellEdits.filter((e) => !matchedEditIds.has(e.id))
            // "edit at …[ by …]" inline text — the "by" part only for a
            // viewer with canEdit, same gate as the Edit button itself. The
            // saved reason (e.note) isn't repeated in the visible text (no
            // separate history window any more, per Jeff), but it's still
            // one hover away via the title tooltip rather than lost.
            const editNote = (e) => `edit at ${new Date(e.edited_at).toLocaleString()}${canEdit ? ` by ${e.edited_by_name}` : ''}`
            const editTitle = (e) => e.note || undefined
            return (
              <div key={key} className="rounded-xl border border-brand-100 bg-white p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800">{format(parseISO(cell.date), 'EEE, MMM d yyyy')}</span>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{storeName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {breakRow && breakMinutes > 0 && (
                      <span className="text-xs text-gray-500" title={editTitle(breakRow)}>
                        Break {formatBreakUnits(breakRow.break_half_hours)} (−{formatMinutes(breakMinutes)}) · {editNote(breakRow)}
                      </span>
                    )}
                    <span className="text-sm font-medium text-brand-700">Total: {formatMinutes(total)}</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingCell({
                            storeId: cell.storeId,
                            date: cell.date,
                            punches,
                            breakHalfHours: breakRow?.break_half_hours ?? 0,
                          })
                        }
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  {cell.sessions.map((s, idx) => {
                    const sessionEdits = sessionEditsList[idx]
                    return (
                      <div key={idx} className="flex items-center justify-between text-sm text-gray-600">
                        <span>
                          {/* Jeff, 2026-10-02: a clock_out with no matching clock_in
                              (see pairEventsIntoSessions' 2026-10-02 comment in
                              attendance.js) used to be invisible everywhere — now
                              that it's kept instead of silently dropped, this has
                              to render without crashing on a null s.clockIn too. */}
                          {s.clockIn ? format(new Date(s.clockIn.occurred_at), 'h:mm a') : 'no clock-in recorded'} –{' '}
                          {s.clockOut ? format(new Date(s.clockOut.occurred_at), 'h:mm a') : 'still clocked in'}
                          {!!sessionEdits.length && (
                            <span className="ml-2 text-xs text-amber-600" title={editTitle(sessionEdits[0])}>
                              {editNote(sessionEdits[0])}
                            </span>
                          )}
                        </span>
                        <span className="text-gray-400">{s.inProgress ? 'In progress' : formatMinutes(s.minutes)}</span>
                      </div>
                    )
                  })}
                  {unmatchedEdits.map((e) => (
                    <div key={e.id} className="text-xs text-amber-600" title={editTitle(e)}>
                      Deleted {e.before_event_type === 'clock_in' ? 'clock in' : 'clock out'} at{' '}
                      {e.before_occurred_at ? format(new Date(e.before_occurred_at), 'h:mm a') : '—'} ({editNote(e)})
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
          initialBreakHalfHours={editingCell.breakHalfHours}
          currentStoreId={currentStoreId}
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
          initialBreakHalfHours={0}
          currentStoreId={currentStoreId}
          editor={editor}
          onClose={() => setAddingRecord(false)}
          onSaved={() => {
            setAddingRecord(false)
            load()
          }}
        />
      )}
    </div>
  )
}
