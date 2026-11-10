import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Button from '../../../components/ui/Button'
import { supabase } from '../../../lib/supabaseClient'
import {
  formatMinutes,
  formatBreakUnits,
  breakMinutesFromHalfHours,
  pairEventsIntoSessions,
  groupSessionsIntoCells,
} from '../../../lib/attendance'
import AttendanceCellEditModal from '../../dashboard/time-attendance/AttendanceCellEditModal'
import {
  getStaffTimeDiscrepancies,
  proposeRosterSync,
  applyRosterSync,
  dayClockSpan,
  clockLabel,
  DISCREPANCY_THRESHOLD_MINUTES,
} from '../../../lib/timeDiscrepancy'
import { thisWeekStart } from '../../roster-hub/shared/rosterWeeks'

// Jeff, 2026-11-10: "Attendance Exceptions，按下去可以選擇哪一週，預設是本週，然後會列出該週所有員工
// 打卡時間跟班表有差異15分鐘以上的紀錄，其實就像是把有小紅點提示的員工紀錄整理在一起，一樣會列出
// roster time跟打卡time，點擊roster time顯示班表時間跟休息次數小視窗，點擊打卡time當天顯示打卡的紀錄，
// 兩個視窗可以同時存在以便比對，兩個視窗都有關閉按鍵。每一條紀錄後面有Sync..." — the same check that
// puts a red dot on a name in Staff Time Logs (getStaffTimeDiscrepancies: a day's net clocked
// minutes vs its net rostered minutes, 15+ minutes apart), gathered across every staff member
// for one chosen week. The two detail windows are plain floating cards, not modals, so both
// can stay open next to the list (and each other) for comparing.
export default function AttendanceExceptionsView({ staff, currentStoreId, canEdit = false, editor = null, onBack }) {
  const { refreshTimeDiscrepancies } = useAuth()
  const [weekStart, setWeekStart] = useState(() => thisWeekStart())
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState([])
  const [showNoted, setShowNoted] = useState(false)
  const [punchCard, setPunchCard] = useState(null)
  const [syncRow, setSyncRow] = useState(null)
  const [form, setForm] = useState({ startTime: '', endTime: '', breakHalfHours: '' })
  const [saving, setSaving] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [flash, setFlash] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  // Jeff, 2026-11-11: the Clocked window's Edit button — same editor as Edit on a day in a
  // person's own log (AttendanceCellEditModal), same permission (admin/developer, or a
  // shop_manager with "Edit attendance logs").
  const [editCell, setEditCell] = useState(null)
  const [editLoading, setEditLoading] = useState(false)

  async function openEdit(card) {
    setEditLoading(true)
    const day = parseISO(card.date)
    const { data } = await supabase
      .from('attendance_events')
      .select('*')
      .eq('profile_id', card.profileId)
      .gte('occurred_at', addDays(day, -1).toISOString())
      .lte('occurred_at', addDays(day, 2).toISOString())
      .order('occurred_at', { ascending: true })
    setEditLoading(false)
    const cells = groupSessionsIntoCells(pairEventsIntoSessions(data ?? [])).filter((c) => c.date === card.date)
    const cell = cells.find((c) => c.storeId === currentStoreId) ?? cells[0]
    setEditCell({
      profileId: card.profileId,
      storeId: cell?.storeId ?? currentStoreId,
      date: card.date,
      punches: cell ? cell.sessions.flatMap((s) => [s.clockIn, s.clockOut].filter(Boolean)) : [],
      breakHalfHours: card.attendanceBreakHalfHours ?? 0,
      // Open on top of the Clocked window (next to the Roster window it is compared with).
      anchor: (() => {
        const r = document.querySelector('[data-float-tone="green"]')?.getBoundingClientRect()
        return r ? { x: r.left, y: r.top } : null
      })(),
    })
  }

  const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')
  const staffKey = staff.map((s) => s.id).join(',')
  const nameById = useMemo(
    () => new Map(staff.map((s) => [s.id, `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || 'Unnamed'])),
    [staff]
  )

  useEffect(() => {
    if (!currentStoreId || !staff.length) {
      setDays([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    getStaffTimeDiscrepancies(currentStoreId, staff.map((s) => s.id), { from: weekStart, to: weekEnd }).then((result) => {
      if (!active) return
      const rows = []
      Object.entries(result).forEach(([profileId, v]) => {
        v.days.forEach((d) => {
          if (d.date >= weekStart && d.date <= weekEnd) rows.push({ ...d, profileId })
        })
      })
      // By name (A–Z), and one person's days oldest → newest.
      rows.sort((a, b) => (nameById.get(a.profileId) ?? '').localeCompare(nameById.get(b.profileId) ?? '') || a.profileId.localeCompare(b.profileId) || a.date.localeCompare(b.date))
      setDays(rows)
      setLoading(false)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStoreId, weekStart, weekEnd, staffKey, reloadTick])

  const visibleDays = showNoted ? days : days.filter((d) => !d.hidden)
  const notedCount = days.filter((d) => d.hidden).length
  const isThisWeek = weekStart === thisWeekStart()

  function shiftWeek(delta) {
    setWeekStart(format(addDays(parseISO(weekStart), delta * 7), 'yyyy-MM-dd'))
  }

  function openSync(row) {
    const p = proposeRosterSync(row)
    setForm({ startTime: p.startTime, endTime: p.endTime, breakHalfHours: String(p.breakHalfHours) })
    setSyncError('')
    setSyncRow({ ...row, proposal: p })
  }

  function closeDayWindows(profileId, date) {
    const k = `${profileId}|${date}`
    setPunchCard((c) => (c?.key === k ? null : c))
    setSyncRow((r) => (r && `${r.profileId}|${r.date}` === k ? null : r))
  }

  async function confirmSync() {
    if (!syncRow) return
    if (!form.startTime || !form.endTime) {
      setSyncError('Start and end time are required.')
      return
    }
    const brk = form.breakHalfHours === '' ? null : Number(form.breakHalfHours)
    if (brk != null && (!Number.isFinite(brk) || brk < 0)) {
      setSyncError('Break must be 0 or more (1 = 30 minutes).')
      return
    }
    setSaving(true)
    setSyncError('')
    const { error } = await applyRosterSync({
      entryId: syncRow.entryId,
      startTime: form.startTime,
      endTime: form.endTime,
      breakHalfHours: brk,
    })
    setSaving(false)
    if (error) {
      setSyncError(error.message || 'Could not update the roster — please try again.')
      return
    }
    setFlash(`Roster updated: ${nameById.get(syncRow.profileId)}, ${format(parseISO(syncRow.date), 'EEE d MMM')}`)
    // Jeff, 2026-11-11: applying closes every window for that day, so nothing has to be
    // closed one by one afterwards.
    closeDayWindows(syncRow.profileId, syncRow.date)
    setReloadTick((t) => t + 1)
    refreshTimeDiscrepancies?.()
  }

  const cardsOpen = !!(punchCard || syncRow)

  return (
    <div className={cardsOpen ? 'pb-72' : undefined}>
      <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-600 hover:underline">
        ← Staff Time Logs
      </button>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Attendance Exceptions</h1>
      <p className="mb-4 text-sm text-gray-500">
        Days where the clocked time and the rostered time are {DISCREPANCY_THRESHOLD_MINUTES}+ minutes apart.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-200 text-lg text-brand-700 hover:bg-brand-50"
          aria-label="Previous week"
        >
          ‹
        </button>
        <div className="min-w-[10rem] text-center leading-tight">
          <div className="text-sm font-semibold text-gray-800">{isThisWeek ? 'This week' : 'Week of'}</div>
          <div className="text-xs text-gray-500">
            {format(parseISO(weekStart), 'd MMM')} – {format(parseISO(weekEnd), 'd MMM yyyy')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => shiftWeek(1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-200 text-lg text-brand-700 hover:bg-brand-50"
          aria-label="Next week"
        >
          ›
        </button>
        <label className="ml-1 flex items-center gap-1 text-xs text-gray-500">
          Jump to
          <input
            type="date"
            className="input !w-auto !py-1 text-sm"
            value={weekStart}
            onChange={(e) => e.target.value && setWeekStart(thisWeekStart(parseISO(e.target.value)))}
          />
        </label>
        {!isThisWeek && (
          <button
            type="button"
            onClick={() => setWeekStart(thisWeekStart())}
            className="rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            This week
          </button>
        )}
      </div>

      {notedCount > 0 && (
        <label className="mb-3 flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={showNoted} onChange={(e) => setShowNoted(e.target.checked)} />
          Also show {notedCount} record{notedCount === 1 ? '' : 's'} already marked as noted
        </label>
      )}
      {flash && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{flash}</p>}

      {loading ? (
        <LoadingSpinner />
      ) : !visibleDays.length ? (
        <EmptyState label="No exceptions this week." />
      ) : (
        <div className="space-y-2">
          {visibleDays.map((d) => {
            const span = dayClockSpan(d)
            const hasClock = !!(span.firstIn || span.lastOut)
            const rosterText =
              d.rosterStartTime && d.rosterEndTime ? `${d.rosterStartTime.slice(0, 5)}–${d.rosterEndTime.slice(0, 5)}` : '—'
            const clockText = hasClock ? `${clockLabel(span.firstIn) ?? '?'}–${clockLabel(span.lastOut) ?? '?'}` : 'No clock records'
            const key = `${d.profileId}|${d.date}`
            const name = nameById.get(d.profileId)
            const rosterBreak = formatBreakUnits(d.rosterBreakHalfHours)
            // "Noted" rows are faded — but only their own content, not the whole row: opacity on the
            // row would also fade the Clocked / Sync windows inside it and trap them under the rows below
            // (they couldn't be clicked or closed).
            const fade = d.hidden ? 'opacity-60' : ''
            return (
              <div
                key={key}
                className={`relative flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-brand-100 bg-white px-3 py-2.5`}
              >
                <div className={`w-full min-w-[8rem] sm:w-40 ${fade}`}>
                  <div className="text-sm font-medium text-gray-800">{name}</div>
                  <div className="text-xs text-gray-500">{format(parseISO(d.date), 'EEE d MMM')}</div>
                </div>
                {/* Roster box: plain info (no window) — rostered time, break, and total after break. */}
                <div className={`rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-left text-sm ${fade}`} title="Rostered shift">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-blue-600">Roster</span>
                  <span className="whitespace-nowrap font-semibold tabular-nums text-blue-900">{rosterText}</span>
                  {rosterBreak && (
                    <span className="ml-1.5 rounded bg-red-50 px-1.5 py-px text-[11px] font-semibold text-red-500">B{rosterBreak}</span>
                  )}
                  <span className="ml-1.5 text-xs font-semibold tabular-nums text-blue-700">· {formatMinutes(d.scheduledMinutes)}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPunchCard({
                      key,
                      profileId: d.profileId,
                      name,
                      date: d.date,
                      sessions: d.sessions,
                      attendanceBreakHalfHours: d.attendanceBreakHalfHours,
                      actualMinutes: d.actualMinutes,
                    })
                  }
                  className={`rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-left text-sm hover:bg-emerald-100 ${fade}`}
                  title="Show that day's clock in/out records"
                >
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-emerald-600">Clocked</span>
                  <span className="whitespace-nowrap font-semibold tabular-nums text-emerald-900 underline decoration-dotted underline-offset-2">
                    {clockText}
                  </span>
                </button>
                <div className={`text-sm font-medium text-red-600 ${fade}`}>
                  {d.diffMinutes > 0 ? '+' : '−'}
                  {formatMinutes(Math.abs(d.diffMinutes))} {d.diffMinutes > 0 ? 'more' : 'less'}
                </div>
                <button
                  type="button"
                  onClick={() => openSync(d)}
                  disabled={!hasClock}
                  title={hasClock ? 'Sync Roster with Attendance' : 'No clock records to sync from'}
                  className={`ml-auto rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${fade}`}
                >
                  Sync
                </button>
                {/* Clocked / Sync windows open side by side right under the row they were opened from. */}
                {(punchCard?.key === key || (syncRow && `${syncRow.profileId}|${syncRow.date}` === key)) && (
                  <div className="pointer-events-none absolute left-2 right-2 top-full z-40 mt-1.5 flex flex-col gap-2 sm:left-44 sm:right-auto sm:flex-row sm:flex-wrap sm:items-start">
                    {punchCard?.key === key && (
                      <FloatCard
                        tone="green"
                        tag="Clocked"
                        title={`${punchCard.name} — clock records`}
                        subtitle={format(parseISO(punchCard.date), 'EEE, MMM d')}
                        onClose={() => setPunchCard(null)}
                      >
                        {punchCard.sessions.length ? (
                          punchCard.sessions.map((s, i) => (
                            <Row key={i} strong label={`${clockLabel(s.clockIn) ?? 'no clock-in'} – ${s.clockOut ? clockLabel(s.clockOut) : 'still clocked in'}`}>
                              {s.inProgress ? 'In progress' : formatMinutes(s.minutes)}
                            </Row>
                          ))
                        ) : (
                          <p className="text-sm text-gray-500">No clock in/out recorded that day.</p>
                        )}
                        {breakMinutesFromHalfHours(punchCard.attendanceBreakHalfHours) > 0 && (
                          <Row label={`Break ${formatBreakUnits(punchCard.attendanceBreakHalfHours)}`}>
                            −{formatMinutes(breakMinutesFromHalfHours(punchCard.attendanceBreakHalfHours))}
                          </Row>
                        )}
                        <Row label="Clocked (after break)">{formatMinutes(punchCard.actualMinutes)}</Row>
                        {canEdit && (
                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={() => openEdit(punchCard)}
                              disabled={editLoading}
                              className="rounded-lg border border-emerald-400 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              {editLoading ? 'Loading…' : 'Edit'}
                            </button>
                          </div>
                        )}
                      </FloatCard>
                    )}
                    {syncRow && `${syncRow.profileId}|${syncRow.date}` === key && (
            <FloatCard
              tone="orange"
              tag="Sync"
              title="Sync Roster with Attendance"
              subtitle={`${nameById.get(syncRow.profileId)} · ${format(parseISO(syncRow.date), 'EEE, MMM d')}`}
              onClose={() => !saving && setSyncRow(null)}
            >
              <div className="space-y-3 text-sm text-gray-700">
                <div className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">
                  <div>
                    <span className="font-semibold text-blue-600">Roster now:</span> {syncRow.rosterStartTime?.slice(0, 5) ?? '—'}–
                    {syncRow.rosterEndTime?.slice(0, 5) ?? '—'}, break {formatBreakUnits(syncRow.rosterBreakHalfHours) ?? 'none'}
                  </div>
                  <div>
                    <span className="font-semibold text-emerald-600">Clocked:</span> {syncRow.proposal.startFromClock ?? '—'}–
                    {syncRow.proposal.endFromClock ?? '—'}
                    {syncRow.proposal.breakFromAttendance ? `, break ${formatBreakUnits(syncRow.attendanceBreakHalfHours) ?? 'none'}` : ''}
                  </div>
                  <div className="mt-1 text-gray-400">
                    Start and end are rounded to the nearest 15 minutes from the clock times. You can change anything below.
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">Start</span>
                    <input type="time" className="input" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">End</span>
                    <input type="time" className="input" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">Break (½h)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      inputMode="decimal"
                      className="input"
                      value={form.breakHalfHours}
                      onChange={(e) => setForm((f) => ({ ...f, breakHalfHours: e.target.value }))}
                    />
                  </label>
                </div>
                {syncError && <p className="text-sm text-red-600">{syncError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setSyncRow(null)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={confirmSync} disabled={saving}>
                    {saving ? 'Applying…' : 'Apply to roster'}
                  </Button>
                </div>
              </div>
            </FloatCard>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Floating windows — deliberately not Modals: no backdrop (the list stays visible and usable),
          each can be dragged by its title bar, and Roster / Clocked / Sync can all be up at once. */}
      {editCell && (
        <AttendanceCellEditModal
          profileId={editCell.profileId}
          storeId={editCell.storeId}
          date={editCell.date}
          punches={editCell.punches}
          initialBreakHalfHours={editCell.breakHalfHours}
          currentStoreId={currentStoreId}
          side
          anchor={editCell.anchor}
          editor={editor}
          onClose={() => {
            // Closing the editor (cancel, ✕ or after saving) closes that day's other windows too.
            closeDayWindows(editCell.profileId, editCell.date)
            setEditCell(null)
          }}
          onSaved={() => {
            closeDayWindows(editCell.profileId, editCell.date)
            setEditCell(null)
            setReloadTick((t) => t + 1)
            refreshTimeDiscrepancies?.()
          }}
        />
      )}
    </div>
  )
}

const TONES = {
  blue: { border: 'border-blue-400', head: 'bg-blue-100 border-blue-200', title: 'text-blue-900', tag: 'bg-blue-600' },
  green: { border: 'border-emerald-400', head: 'bg-emerald-100 border-emerald-200', title: 'text-emerald-900', tag: 'bg-emerald-600' },
  orange: { border: 'border-brand-400', head: 'bg-brand-100 border-brand-200', title: 'text-brand-900', tag: 'bg-brand-600' },
}

// A small draggable window: grab the coloured title bar (mouse, finger or pen) and move it
// anywhere, e.g. off the list it would otherwise cover. Position is a plain translate offset.
function FloatCard({ tone, tag, title, subtitle, onClose, children }) {
  const t = TONES[tone]
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef(null)
  function onPointerDown(e) {
    if (e.target.closest('button')) return
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e) {
    if (!drag.current) return
    setPos({ x: drag.current.ox + e.clientX - drag.current.sx, y: drag.current.oy + e.clientY - drag.current.sy })
  }
  function onPointerUp() {
    drag.current = null
  }
  return (
    <div
      data-float-tone={tone}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      className={`pointer-events-auto w-full rounded-xl border-2 bg-white shadow-2xl sm:w-80 ${t.border}`}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: 'none' }}
        className={`flex cursor-move select-none items-start justify-between gap-2 rounded-t-[10px] border-b px-3 py-2 ${t.head}`}
        title="Drag to move"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white ${t.tag}`}>{tag}</span>
            <span className={`truncate text-sm font-semibold ${t.title}`}>{title}</span>
          </div>
          <div className="mt-0.5 text-xs text-gray-600">{subtitle}</div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-full p-1 text-gray-500 hover:bg-white/70 hover:text-gray-800"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="space-y-1.5 px-3 py-2.5">{children}</div>
    </div>
  )
}

function Row({ label, children, strong = false }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={strong ? 'font-bold tabular-nums text-gray-800' : 'text-gray-500'}>{label}</span>
      <span className="font-medium tabular-nums text-gray-800">{children}</span>
    </div>
  )
}
