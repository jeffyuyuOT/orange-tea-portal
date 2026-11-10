import { useEffect, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import LoadingSpinner from '../ui/LoadingSpinner'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { fetchSubmittedPeriod, thisWeekStart } from '../../modules/roster-hub/shared/rosterWeeks'

// Jeff, 2026-11-10: "手機板登入後原本相機快捷鍵(打卡用)的旁邊新增一個圖示是可以
// 看my roster。預設是本周，可以左右切換看上週或下週(如果已經有的話)...手機畫面可以
// 一次看到全部的天，不要像在my roster裡看要左右滑動" — a header quick-view of the
// signed-in person's own shifts. Deliberately NOT RosterWeekTable: that grid
// is staff-down / days-across and has to scroll sideways on a phone, so this
// lays the 7 days out as 7 short rows instead (everything visible at once,
// no horizontal scroll). Last / this / next week are all fetched up front so
// the ‹ › buttons can grey themselves out when that week has no submitted
// roster (fetchSubmittedPeriod, the same "published" rule My Roster uses).
const OFFSETS = [-1, 0, 1]
const WEEK_LABELS = { '-1': 'Last week', 0: 'This week', 1: 'Next week' }

export default function MyRosterQuickModal({ open, onClose }) {
  const { currentStoreId, profile, rosterUpdates, refreshRosterUpdates } = useAuth()
  const [offset, setOffset] = useState(0)
  const [weeks, setWeeks] = useState(null)
  const [loading, setLoading] = useState(false)
  // Which of last/this/next week have an unseen change for this person (see the
  // 2026-11-10 note below) and which of those they've looked at in this session.
  const [changes, setChanges] = useState(null)
  const [seen, setSeen] = useState(() => new Set())

  // Jeff, 2026-11-10: "看了後update也會跟著消失" + "如果更新的是下週班表，打開視窗時
  // 預設顯示本週，應該不能算已讀，要切換到那一個頁面才可以...可以在箭頭上顯示紅點嗎" —
  // opening this quick view does NOT count as having looked at My Roster. Each of
  // last/this/next week is "seen" only once it's actually on screen, and the shared
  // roster_view_state cursor (migration 0047 — what drives the header dot, the
  // sidebar/section badges and the app-icon count) only advances once every week
  // that has an unseen change (roster_change_events.roster_period_id) has been
  // looked at. Until then the ‹ › arrow toward that week carries its own red dot.
  // Changes on a week outside last/this/next can't be shown here, so they don't
  // hold the dot up (the My Roster page itself still clears everything on open).
  const viewedAt = changes?.viewedAt ?? null
  function weekHasUpdate(o) {
    const p = weeks?.[o]?.period
    if (!p || !changes) return false
    return changes.events.some((e) => e.roster_period_id === p.id && (!viewedAt || e.changed_at > viewedAt))
  }
  const unseenOffsets = OFFSETS.filter((o) => weekHasUpdate(o) && !seen.has(o))

  // The week on screen counts as seen as soon as it has finished loading.
  useEffect(() => {
    if (!open || loading || !weeks) return
    setSeen((prev) => (prev.has(offset) ? prev : new Set(prev).add(offset)))
  }, [open, loading, weeks, offset])

  // Everything with an update has been looked at -> clear the shared signal.
  useEffect(() => {
    if (!open || loading || !weeks || !changes || !currentStoreId || !profile?.id) return
    if (!rosterUpdates?.myRoster || unseenOffsets.length) return
    supabase
      .from('roster_view_state')
      .upsert(
        { profile_id: profile.id, store_id: currentStoreId, my_roster_viewed_at: new Date().toISOString() },
        { onConflict: 'profile_id,store_id' }
      )
      .then(() => refreshRosterUpdates())
  }, [open, loading, weeks, changes, seen, rosterUpdates?.myRoster]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !currentStoreId || !profile?.id) return
    let active = true
    setLoading(true)
    setOffset(0)
    setSeen(new Set())
    setChanges(null)
    const base = parseISO(thisWeekStart())
    const starts = OFFSETS.map((o) => format(addDays(base, o * 7), 'yyyy-MM-dd'))
    Promise.all([
      Promise.all(starts.map((s) => fetchSubmittedPeriod(currentStoreId, s))),
      supabase
        .from('roster_view_state')
        .select('my_roster_viewed_at')
        .eq('profile_id', profile.id)
        .eq('store_id', currentStoreId)
        .maybeSingle(),
      supabase
        .from('roster_change_events')
        .select('roster_period_id, changed_at')
        .eq('store_id', currentStoreId)
        .eq('profile_id', profile.id),
    ])
      .then(async ([periods, { data: viewState }, { data: eventRows }]) => {
        const ids = periods.filter(Boolean).map((p) => p.id)
        let rows = []
        if (ids.length) {
          const { data } = await supabase
            .from('roster_entries')
            .select('*')
            .in('roster_period_id', ids)
            .eq('profile_id', profile.id)
          rows = data ?? []
        }
        if (!active) return
        const next = {}
        OFFSETS.forEach((o, i) => {
          const p = periods[i]
          next[o] = { start: starts[i], period: p, entries: p ? rows.filter((r) => r.roster_period_id === p.id) : [] }
        })
        setChanges({ viewedAt: viewState?.my_roster_viewed_at ?? null, events: eventRows ?? [] })
        setWeeks(next)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setWeeks(null)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, currentStoreId, profile?.id])

  const week = weeks?.[offset]
  const canPrev = offset > OFFSETS[0] && !!weeks?.[offset - 1]?.period
  const canNext = offset < OFFSETS[OFFSETS.length - 1] && !!weeks?.[offset + 1]?.period
  const today = format(new Date(), 'yyyy-MM-dd')
  const start = week ? parseISO(week.start) : null
  const days = start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : []

  // A week on that side of the one on screen still has an unseen change.
  const prevDot = OFFSETS.some((o) => o < offset && unseenOffsets.includes(o))
  const nextDot = OFFSETS.some((o) => o > offset && unseenOffsets.includes(o))
  const arrowDot = (
    <span
      className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-red-500"
      aria-label="Update"
    />
  )

  const arrowClass =
    'relative flex h-9 w-9 items-center justify-center rounded-lg border border-brand-200 text-lg text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="My Roster"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" className={arrowClass} disabled={!canPrev} onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">
          ‹
          {canPrev && prevDot && arrowDot}
        </button>
        <div className="text-center leading-tight">
          <div className="text-sm font-semibold text-gray-800">{WEEK_LABELS[offset]}</div>
          {start && (
            <div className="text-xs text-gray-500">
              {format(start, 'd MMM')} – {format(addDays(start, 6), 'd MMM')}
            </div>
          )}
        </div>
        <button type="button" className={arrowClass} disabled={!canNext} onClick={() => setOffset((o) => o + 1)} aria-label="Next week">
          ›
          {canNext && nextDot && arrowDot}
        </button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !week ? (
        <div className="py-8 text-center text-sm text-gray-400">Couldn't load your roster. Please try again.</div>
      ) : !week.period ? (
        <div className="py-8 text-center text-sm text-gray-400">Not available — this week's roster hasn't been published yet.</div>
      ) : (
        <ul className="divide-y divide-brand-50 rounded-lg border border-brand-100">
          {days.map((d) => {
            const dayStr = format(d, 'yyyy-MM-dd')
            const shift = week.entries.find((e) => e.work_date === dayStr && (e.start_time || e.end_time))
            const isToday = dayStr === today
            return (
              <li
                key={dayStr}
                className={`flex items-center gap-3 border-l-4 px-3 py-2.5 ${
                  isToday ? 'border-brand-500 bg-brand-50' : 'border-transparent'
                }`}
              >
                {/* Jeff, 2026-11-10: time right beside the date, and every row's time starting at
                    the same spot whether or not it has a break — the date column is a fixed
                    width, the time a fixed-width tabular-number slot, and the B×n tag always
                    follows in its own slot. Today is marked by the left bar + tint instead of a
                    "Today" word, which used to wrap the date onto two lines. */}
                <div className="w-[5.5rem] shrink-0 whitespace-nowrap text-sm font-medium text-gray-700">
                  {format(d, 'EEE d/M')}
                </div>
                {shift ? (
                  <>
                    <span className="w-[7.5rem] shrink-0 whitespace-nowrap text-sm font-medium tabular-nums text-gray-800">
                      {shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)}
                    </span>
                    {Number(shift.break_half_hours) > 0 && (
                      <span
                        className="whitespace-nowrap rounded bg-red-50 px-1.5 py-px text-[11px] font-semibold text-red-500"
                        title="Break (half-hour units — 1 = 30 min, 2 = 1 hr)"
                      >
                        B×{Number(shift.break_half_hours)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-gray-300">—</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
