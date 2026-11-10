import { useEffect, useMemo, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { formatMinutes, formatBreakUnits, breakMinutesFromHalfHours } from '../../../lib/attendance'
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
export default function AttendanceExceptionsView({ staff, currentStoreId, onBack }) {
  const { refreshTimeDiscrepancies } = useAuth()
  const [weekStart, setWeekStart] = useState(() => thisWeekStart())
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState([])
  const [showNoted, setShowNoted] = useState(false)
  const [rosterCard, setRosterCard] = useState(null)
  const [punchCard, setPunchCard] = useState(null)
  const [syncRow, setSyncRow] = useState(null)
  const [form, setForm] = useState({ startTime: '', endTime: '', breakHalfHours: '' })
  const [saving, setSaving] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [flash, setFlash] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

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
      rows.sort((a, b) => a.date.localeCompare(b.date) || (nameById.get(a.profileId) ?? '').localeCompare(nameById.get(b.profileId) ?? ''))
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
    setSyncRow(null)
    // The card for this row, if open, would now show the old roster values.
    setRosterCard((c) => (c && c.key === `${syncRow.profileId}|${syncRow.date}` ? null : c))
    setReloadTick((t) => t + 1)
    refreshTimeDiscrepancies?.()
  }

  const cardsOpen = !!(rosterCard || punchCard)

  return (
    <div className={cardsOpen ? 'pb-80' : undefined}>
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
            return (
              <div
                key={key}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-brand-100 bg-white px-3 py-2.5 ${d.hidden ? 'opacity-60' : ''}`}
              >
                <div className="w-full min-w-[8rem] sm:w-40">
                  <div className="text-sm font-medium text-gray-800">{name}</div>
                  <div className="text-xs text-gray-500">{format(parseISO(d.date), 'EEE d MMM')}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setRosterCard({
                      key,
                      name,
                      date: d.date,
                      start: d.rosterStartTime,
                      end: d.rosterEndTime,
                      breakHalfHours: d.rosterBreakHalfHours,
                      scheduledMinutes: d.scheduledMinutes,
                    })
                  }
                  className="text-left text-sm"
                  title="Show the rostered shift"
                >
                  <span className="block text-[11px] uppercase tracking-wide text-gray-400">Roster</span>
                  <span className="whitespace-nowrap font-medium tabular-nums text-gray-800 underline decoration-dotted underline-offset-2">
                    {rosterText}
                  </span>
                  {rosterBreak && (
                    <span className="ml-1.5 rounded bg-red-50 px-1.5 py-px text-[11px] font-semibold text-red-500">B{rosterBreak}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPunchCard({
                      key,
                      name,
                      date: d.date,
                      sessions: d.sessions,
                      attendanceBreakHalfHours: d.attendanceBreakHalfHours,
                      actualMinutes: d.actualMinutes,
                    })
                  }
                  className="text-left text-sm"
                  title="Show that day's clock in/out records"
                >
                  <span className="block text-[11px] uppercase tracking-wide text-gray-400">Clocked</span>
                  <span className="whitespace-nowrap font-medium tabular-nums text-gray-800 underline decoration-dotted underline-offset-2">
                    {clockText}
                  </span>
                </button>
                <div className="text-sm font-medium text-red-600">
                  {d.diffMinutes > 0 ? '+' : '−'}
                  {formatMinutes(Math.abs(d.diffMinutes))} {d.diffMinutes > 0 ? 'more' : 'less'}
                </div>
                <button
                  type="button"
                  onClick={() => openSync(d)}
                  disabled={!hasClock}
                  title={hasClock ? 'Sync Roster with Attendance' : 'No clock records to sync from'}
                  className="ml-auto rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Sync
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Floating detail cards — deliberately not Modals, so both can stay up at once. */}
      {cardsOpen && (
        <div className="pointer-events-none fixed inset-x-2 bottom-2 z-40 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80">
          {rosterCard && (
            <FloatCard title={`${rosterCard.name} — rostered shift`} subtitle={format(parseISO(rosterCard.date), 'EEE, MMM d')} onClose={() => setRosterCard(null)}>
              <Row label="Scheduled time">
                {rosterCard.start && rosterCard.end ? `${rosterCard.start.slice(0, 5)}–${rosterCard.end.slice(0, 5)}` : '—'}
              </Row>
              <Row label="Break">{formatBreakUnits(rosterCard.breakHalfHours) ?? 'None'}</Row>
              <Row label="Rostered (after break)">{formatMinutes(rosterCard.scheduledMinutes)}</Row>
            </FloatCard>
          )}
          {punchCard && (
            <FloatCard title={`${punchCard.name} — clock records`} subtitle={format(parseISO(punchCard.date), 'EEE, MMM d')} onClose={() => setPunchCard(null)}>
              {punchCard.sessions.length ? (
                punchCard.sessions.map((s, i) => (
                  <Row key={i} label={`${clockLabel(s.clockIn) ?? 'no clock-in'} – ${s.clockOut ? clockLabel(s.clockOut) : 'still clocked in'}`}>
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
            </FloatCard>
          )}
        </div>
      )}

      <Modal
        open={!!syncRow}
        onClose={() => !saving && setSyncRow(null)}
        title="Sync Roster with Attendance"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSyncRow(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={confirmSync} disabled={saving}>
              {saving ? 'Applying…' : 'Apply to roster'}
            </Button>
          </>
        }
      >
        {syncRow && (
          <div className="space-y-3 text-sm text-gray-700">
            <p>
              <span className="font-medium">{nameById.get(syncRow.profileId)}</span> · {format(parseISO(syncRow.date), 'EEE, MMM d')}
            </p>
            <div className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">
              <div>
                Roster now: {syncRow.rosterStartTime?.slice(0, 5) ?? '—'}–{syncRow.rosterEndTime?.slice(0, 5) ?? '—'}, break{' '}
                {formatBreakUnits(syncRow.rosterBreakHalfHours) ?? 'none'}
              </div>
              <div>
                Clocked: {syncRow.proposal.startFromClock ?? '—'}–{syncRow.proposal.endFromClock ?? '—'}
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
          </div>
        )}
      </Modal>
    </div>
  )
}

function FloatCard({ title, subtitle, onClose, children }) {
  return (
    <div className="pointer-events-auto rounded-xl border border-brand-200 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b border-brand-100 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-brand-900">{title}</div>
          <div className="text-xs text-gray-500">{subtitle}</div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-brand-50 hover:text-brand-600"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="space-y-1.5 px-3 py-2.5">{children}</div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium tabular-nums text-gray-800">{children}</span>
    </div>
  )
}
