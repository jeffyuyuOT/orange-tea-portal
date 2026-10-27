import { useEffect, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName } from '../../../lib/excelRoster'
import {
  weekDatesFrom,
  loadWeekAvailabilityForProfiles,
  describeDayWithLeave,
  availableWindowsWithLeave,
  leaveWindowOnDate,
} from '../../../lib/availability'
import { timeToMinutes, formatTickLabel, buildTicks, pickColor } from '../../../lib/timelineBar'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Jeff, 2026-09: "在roster hub上的manage roster的action旁邊新增view staff's
// availability，點擊則會跳出視窗顯示編排該週員工登記的available time" — a
// read-only view of everyone's registered availability for the week. Staff
// with nothing saved for a day just read "All day available" (the same
// default computeAvailableWindows falls back to when there's no row), so
// this list is complete for every staff member on the roster, not just the
// ones who've actually filled something in.
//
// Jeff, 2026-10-01: "view staff available time的視窗能做到員工時間資訊用展
// 開顯示，預設不展開，所以視窗一開始是名字的清單，要看哪一個員工再點擊名字
// 展開。再點擊一下則收起" — collapsed by default; the modal opens as a plain
// name list and clicking a name expands just that person's day-by-day grid
// (click again to collapse).
//
// Jeff, 2026-10-27: "manager roster在看員工available time的頁面，上面新增
// tab"By Person" and "By Date"" — the view above is now just the "By
// Person" tab, unchanged. "By Date" is new: Monday–Sunday, click a day to
// expand and see everyone with any available time that day drawn as a
// color-bar timeline (one bar per person), scaled to the store's open/close
// hours from Roster Hub Setting's Labour allocation tab — "其操作方法跟
// labour allocation看時間色條的邏輯一樣", so this reuses that tab's exact
// axis/tick/color mechanics (lib/timelineBar.js) rather than a lookalike
// copy. Desktop hover shows a tooltip; mobile tap opens a small popup
// instead (see DayTimeline below). "手機板的點by date的話會預設展開顯示正
// 在選取排班表的那一天" — handled by the mobileDayIdx prop, lifted up from
// RosterEntryGrid's own mobile day-tabs so this modal can read which day
// those tabs currently show.
export default function StaffAvailabilityModal({ open, onClose, staff, weekStart, mobileDayIdx }) {
  const { currentStoreId } = useAuth()
  const [byProfile, setByProfile] = useState(null)
  // profileId -> that profile's active leave_requests rows touching this
  // week — fetched alongside availability so a day's declared pattern can
  // be reconciled against leave before it's shown (describeDayWithLeave).
  // Jeff, 2026-10-02: "manager roster看staff's available time時會把leave的
  // 時間加上去" — see availability.js's describeDayWithLeave comment for why.
  const [leavesByProfile, setLeavesByProfile] = useState({})
  // Jeff, 2026-10-01: "view staff available time的視窗能做到員工時間資訊用展
  // 開顯示，預設不展開，所以視窗一開始是名字的清單，要看哪一個員工再點擊名字
  // 展開。再點擊一下則收起" — collapsed by default; clicking a name toggles
  // just that person's row independently of every other one (a Set of
  // expanded profile ids, same toggle pattern MessagePage.jsx's thread
  // expand/collapse already uses), so more than one can be open at once if
  // that's what someone wants.
  const [expandedIds, setExpandedIds] = useState(new Set())

  const [tab, setTab] = useState('person')
  // Store's configured open/close hours, same shape RosterSettingsPage.jsx
  // loads for its own Labour allocation timeline.
  const [storeHours, setStoreHours] = useState({ open: '', close: '' })
  // By-Date accordion open/closed state — a Set of 'yyyy-MM-dd' strings,
  // same toggle pattern as expandedIds above.
  const [expandedDates, setExpandedDates] = useState(new Set())
  // Mobile has no hover, so tapping a color bar opens this popup instead —
  // { profile, dateStr, desc } | null.
  const [mobileDetail, setMobileDetail] = useState(null)

  function toggleExpanded(profileId) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
  }

  function toggleDate(dateStr) {
    setExpandedDates((prev) => {
      const next = new Set(prev)
      if (next.has(dateStr)) next.delete(dateStr)
      else next.add(dateStr)
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    setByProfile(null)
    setLeavesByProfile({})
    const profileIds = staff.map((s) => s.id)
    const weekStartDate = parseISO(weekStart)
    const weekEndExclusive = addDays(weekStartDate, 7)
    Promise.all([
      loadWeekAvailabilityForProfiles(profileIds, weekStart),
      profileIds.length
        ? supabase
            .from('leave_requests')
            .select('*')
            .in('profile_id', profileIds)
            .eq('status', 'active')
            .lt('start_at', weekEndExclusive.toISOString())
            .gt('end_at', weekStartDate.toISOString())
        : Promise.resolve({ data: [] }),
    ]).then(([avail, { data: leaves }]) => {
      setByProfile(avail)
      const grouped = {}
      ;(leaves ?? []).forEach((l) => {
        ;(grouped[l.profile_id] ??= []).push(l)
      })
      setLeavesByProfile(grouped)
    })
    // `staff` is re-derived from a fresh query each time ManageRosterPage
    // loads — comparing its length keeps this from re-fetching every render
    // once the modal's open without missing a genuine roster change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, weekStart, staff.length])

  useEffect(() => {
    if (!open || !currentStoreId) return
    supabase
      .from('stores')
      .select('roster_open_time, roster_close_time')
      .eq('id', currentStoreId)
      .single()
      .then(({ data }) => {
        setStoreHours({
          open: data?.roster_open_time?.slice(0, 5) ?? '',
          close: data?.roster_close_time?.slice(0, 5) ?? '',
        })
      })
  }, [open, currentStoreId])

  // Reset to a clean state every time the modal opens, and — mobile only —
  // default-expand whichever day RosterEntryGrid's own mobile day-tabs are
  // currently showing ("手機板的點by date的話會預設展開顯示正在選取排班表
  // 的那一天"). Checked once on open rather than kept reactive, since the
  // point is just "start where the grid was", not tracking it afterwards.
  useEffect(() => {
    if (!open) return
    setTab('person')
    setMobileDetail(null)
    let initial = new Set()
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches) {
      const weekDates = weekDatesFrom(weekStart)
      const d = weekDates[Math.min(mobileDayIdx ?? 0, weekDates.length - 1)]
      if (d) initial = new Set([d])
    }
    setExpandedDates(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const dates = weekDatesFrom(weekStart)
  const sorted = [...staff].sort((a, b) => rosterDisplayName(a).localeCompare(rosterDisplayName(b)))

  const windowStart = storeHours.open ? timeToMinutes(storeHours.open) : 0
  let windowEnd = storeHours.close ? timeToMinutes(storeHours.close) : 1440
  if (windowEnd <= windowStart) windowEnd = 1440
  const span = windowEnd - windowStart
  const ticks = buildTicks(windowStart, windowEnd)

  // Every staff member with any available time on `dateStr` (leave already
  // reconciled in), one color per person — "一個人一個色條" — threaded
  // sequentially through the sorted list the same way RosterSettingsPage's
  // WeeklyTimelineView threads prevColor through a day's rules, so two
  // people shown back-to-back never land on the same color.
  //
  // Jeff, 2026-10-27: "員工的色條也是要在營業時間內，雖然他是填all day
  // available系統是會讀成從12am開始" — availableWindowsWithLeave answers in
  // real minutes-since-midnight (an "All day available" person is literally
  // 0–1440), but this timeline's axis only spans the store's open/close
  // window. Without clipping, that person's bar math goes negative/past
  // 100% and the segment renders off the visible track — clip every window
  // to [windowStart, windowEnd] here, same as RosterSettingsPage.jsx's
  // TimeSlotBar clips a shift to its own window, so nothing is ever drawn
  // (or tapped/hovered) outside business hours.
  // Jeff, 2026-10-27 (later): "顯示資訊也是顯示all day available，before幾
  // 點，after幾點，或是有特別的時間段" — the hover tooltip / tap popup text
  // should read the same way the By Person tab already does (mode-aware:
  // "All day available" / "Before 2:00 PM" / "After 2:00 PM" / an explicit
  // range list), not a literal readout of the business-hours-clipped bar
  // segments above — so `desc` is computed separately via
  // describeDayWithLeave, from the UNCLIPPED availability, same call the By
  // Person tab makes for this exact (dayRow, windows, leave) triple.
  function peopleForDate(dateStr) {
    let prevColor = null
    return sorted
      .map((s) => {
        const entry = byProfile?.[s.id]?.[dateStr]
        const leaveWindowsForDay = (leavesByProfile[s.id] ?? [])
          .map((l) => leaveWindowOnDate(l, dateStr))
          .filter(Boolean)
        const rawWindows = availableWindowsWithLeave(entry?.dayRow, entry?.windows, leaveWindowsForDay)
        const windows = rawWindows
          .map((w) => ({ start: Math.max(w.start, windowStart), end: Math.min(w.end, windowEnd) }))
          .filter((w) => w.end > w.start)
        if (!windows.length) return null
        const desc = describeDayWithLeave(entry?.dayRow, entry?.windows, leaveWindowsForDay)
        const color = pickColor(s.id, prevColor)
        prevColor = color
        return { profile: s, windows, desc, color }
      })
      .filter(Boolean)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        wide
        title={`Staff Availability — week of ${format(parseISO(weekStart), 'd MMM yyyy')}`}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        {!byProfile ? (
          <LoadingSpinner />
        ) : (
          <>
            <div className="mb-3 flex gap-2">
              <TabButton active={tab === 'person'} onClick={() => setTab('person')}>
                By Person
              </TabButton>
              <TabButton active={tab === 'date'} onClick={() => setTab('date')}>
                By Date
              </TabButton>
            </div>

            {tab === 'person' ? (
              !sorted.length ? (
                <p className="text-sm text-gray-400">No staff on this store's roster.</p>
              ) : (
                <div className="space-y-2">
                  {sorted.map((s) => {
                    const isOpen = expandedIds.has(s.id)
                    return (
                      <div key={s.id} className="rounded-lg border border-brand-100 p-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(s.id)}
                          className="flex w-full items-center justify-between text-left text-sm font-semibold text-gray-800"
                        >
                          <span>{rosterDisplayName(s)}</span>
                          <span className="text-xs font-normal text-gray-400">{isOpen ? '▲' : '▼'}</span>
                        </button>
                        {isOpen && (
                          <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-7">
                            {dates.map((dateStr, i) => {
                              const entry = byProfile[s.id]?.[dateStr]
                              const leaveWindowsForDay = (leavesByProfile[s.id] ?? [])
                                .map((l) => leaveWindowOnDate(l, dateStr))
                                .filter(Boolean)
                              const desc = describeDayWithLeave(entry?.dayRow, entry?.windows, leaveWindowsForDay)
                              return (
                                <div key={dateStr}>
                                  <span className="text-xs font-medium text-gray-400">
                                    {DAY_LABELS[i]} {format(parseISO(dateStr), 'd/M')}
                                  </span>
                                  <div className={desc === 'Unavailable' ? 'text-red-600' : 'text-gray-700'}>{desc}</div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              <div className="space-y-2">
                {dates.map((dateStr, i) => {
                  const isOpen = expandedDates.has(dateStr)
                  const people = isOpen ? peopleForDate(dateStr) : null
                  return (
                    <div key={dateStr} className="rounded-lg border border-brand-100 p-3">
                      <button
                        type="button"
                        onClick={() => toggleDate(dateStr)}
                        className="flex w-full items-center justify-between text-left text-sm font-semibold text-gray-800"
                      >
                        <span>
                          {DAY_LABELS[i]} {format(parseISO(dateStr), 'd MMM')}
                        </span>
                        <span className="text-xs font-normal text-gray-400">
                          {isOpen && people ? `${people.length} available  ` : ''}
                          {isOpen ? '▲' : '▼'}
                        </span>
                      </button>
                      {isOpen && (
                        !people.length ? (
                          <p className="mt-2 text-sm text-gray-400">No one available this day.</p>
                        ) : (
                          <DayTimeline
                            people={people}
                            windowStart={windowStart}
                            span={span}
                            ticks={ticks}
                            onTapPerson={(profile, desc) => setMobileDetail({ profile, dateStr, desc })}
                          />
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </Modal>

      {mobileDetail && (
        <Modal
          open
          onClose={() => setMobileDetail(null)}
          title={rosterDisplayName(mobileDetail.profile)}
          footer={
            <Button variant="secondary" onClick={() => setMobileDetail(null)}>
              Close
            </Button>
          }
        >
          <p className="text-sm text-gray-700">
            <span className="font-medium text-gray-500">
              {DAY_LABELS[dates.indexOf(mobileDetail.dateStr)]} {format(parseISO(mobileDetail.dateStr), 'd MMM')}:{' '}
            </span>
            {mobileDetail.desc}
          </p>
        </Modal>
      )}
    </>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        active ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'
      }`}
    >
      {children}
    </button>
  )
}

// Desktop: one horizontal bar per available person, hour ticks across the
// top, hover shows a tooltip — same axis/segment mechanics as
// RosterSettingsPage.jsx's WeeklyTimelineView/TimeSlotBar (Jeff: "其操作方
// 法跟labour allocation看時間色條的邏輯一樣"), just read-only and keyed by
// staff member instead of by shift label.
// Mobile: a vertical axis instead — hour ticks running down the left edge,
// people as narrow side-by-side columns; tap opens a popup rather than
// relying on hover ("手機板則是點擊色條會出現視窗顯示員工當天可以的時間").
function DayTimeline({ people, windowStart, span, ticks, onTapPerson }) {
  const [hoverId, setHoverId] = useState(null)

  return (
    <div className="mt-2">
      {/* Desktop: horizontal */}
      <div className="hidden sm:block">
        <div className="mb-1 flex items-center gap-2">
          <span className="w-28 shrink-0" />
          <div className="relative h-3 flex-1 text-[10px] text-gray-400">
            {ticks.map((t, i) => {
              const isFirst = i === 0
              const isLast = i === ticks.length - 1
              return (
                <span
                  key={t}
                  className={`absolute ${isFirst ? 'left-0' : isLast ? 'right-0' : '-translate-x-1/2'}`}
                  style={isFirst || isLast ? undefined : { left: `${((t - windowStart) / span) * 100}%` }}
                >
                  {formatTickLabel(t)}
                </span>
              )
            })}
          </div>
        </div>
        <div className="space-y-1">
          {people.map(({ profile, windows, desc, color }) => (
            <div key={profile.id} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs font-medium text-gray-600">{rosterDisplayName(profile)}</span>
              <div className="relative h-7 flex-1 rounded-md border border-gray-200 bg-gray-50">
                {ticks.slice(1, -1).map((t) => (
                  <div
                    key={t}
                    className="absolute top-0 bottom-0 border-l border-gray-200"
                    style={{ left: `${((t - windowStart) / span) * 100}%` }}
                  />
                ))}
                {windows.map((w, i) => (
                  <div
                    key={i}
                    className="absolute top-0.5 bottom-0.5 rounded"
                    style={{
                      left: `${((w.start - windowStart) / span) * 100}%`,
                      width: `${((w.end - w.start) / span) * 100}%`,
                      minWidth: '6px',
                      backgroundColor: color,
                    }}
                    onMouseEnter={() => setHoverId(profile.id)}
                    onMouseLeave={() => setHoverId((cur) => (cur === profile.id ? null : cur))}
                  />
                ))}
                {hoverId === profile.id && (
                  <div className="absolute -top-8 left-0 z-10 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[11px] text-white shadow">
                    {desc}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: vertical */}
      <div className="sm:hidden">
        <div className="flex gap-2">
          <div className="relative w-10 shrink-0" style={{ height: '18rem' }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400"
                style={{ top: `${((t - windowStart) / span) * 100}%` }}
              >
                {formatTickLabel(t)}
              </span>
            ))}
          </div>
          <div className="relative flex-1 rounded-md border border-gray-200 bg-gray-50" style={{ height: '18rem' }}>
            {ticks.slice(1, -1).map((t) => (
              <div
                key={t}
                className="absolute left-0 right-0 border-t border-gray-200"
                style={{ top: `${((t - windowStart) / span) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex gap-1 p-1">
              {people.map(({ profile, windows, desc, color }) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => onTapPerson(profile, desc)}
                  className="relative flex-1"
                  aria-label={rosterDisplayName(profile)}
                >
                  {windows.map((w, i) => (
                    <div
                      key={i}
                      className="absolute left-0 right-0 rounded"
                      style={{
                        top: `${((w.start - windowStart) / span) * 100}%`,
                        height: `${((w.end - w.start) / span) * 100}%`,
                        minHeight: '4px',
                        backgroundColor: color,
                      }}
                    />
                  ))}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {people.map(({ profile, color }) => (
            <span key={profile.id} className="flex items-center gap-1 text-[11px] text-gray-600">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              {rosterDisplayName(profile)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
