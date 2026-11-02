import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName } from '../../../lib/excelRoster'
import { describeDayWithLeave, availableWindowsWithLeave, leaveWindowOnDate } from '../../../lib/availability'
import { timeToMinutes, formatTickLabel, buildHourlyTicks, pickColor } from '../../../lib/timelineBar'

// Jeff, 2026-11-02: the old "View Staff's Availability" button + its
// By Date / By Person tabbed modal are gone. The same two views now hang
// off the roster grid itself:
//   - click a date header (desktop) / tap the already-selected day tab
//     (mobile) -> DayAvailabilityModal, "by date" (everyone's available
//     time that day as a color-bar timeline);
//   - click a staff name -> PersonAvailabilityModal, "by person" (that
//     person's available time for the week) with a second "Shift summary"
//     tab holding what the name click used to show (their scheduled shifts
//     + total hours). Availability is the default tab.
// Availability + leave data are the week's data ManageRosterPage already
// loads for the shift-conflict check, passed in as props — no second fetch.
// Only the store's open/close hours (the timeline axis) are fetched here.

function dayShort(dateStr) {
  return format(parseISO(dateStr), 'EEE')
}

// Store's configured open/close hours, same shape RosterSettingsPage.jsx
// loads for its own Labour allocation timeline.
function useStoreHours(open) {
  const { currentStoreId } = useAuth()
  const [storeHours, setStoreHours] = useState({ open: '', close: '' })
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
  return storeHours
}

// ManageRosterPage resets availabilityByProfile to {} while (re)loading and
// every loaded profile has an entry, so "first profile missing" == not
// loaded yet. Without this a still-loading week would read as "All day
// available" for everyone (the no-row default).
function availabilityLoading(staff, availabilityByProfile) {
  return staff.length > 0 && !availabilityByProfile?.[staff[0].id]
}

function leavesOnDate(leavesByProfile, profileId, dateStr) {
  return (leavesByProfile?.[profileId] ?? []).map((l) => leaveWindowOnDate(l, dateStr)).filter(Boolean)
}

export function DayAvailabilityModal({ open, onClose, dateStr, staff, availabilityByProfile, leavesByProfile }) {
  const storeHours = useStoreHours(open)
  // Mobile has no hover, so tapping a color bar opens this popup instead —
  // { profile, desc } | null.
  const [mobileDetail, setMobileDetail] = useState(null)

  useEffect(() => {
    if (open) setMobileDetail(null)
  }, [open, dateStr])

  if (!open || !dateStr) return null

  const sorted = [...staff].sort((a, b) => rosterDisplayName(a).localeCompare(rosterDisplayName(b)))
  const windowStart = storeHours.open ? timeToMinutes(storeHours.open) : 0
  let windowEnd = storeHours.close ? timeToMinutes(storeHours.close) : 1440
  if (windowEnd <= windowStart) windowEnd = 1440
  const span = windowEnd - windowStart
  // A tick every hour (Jeff: "時間也是每一小時一個刻度").
  const ticks = buildHourlyTicks(windowStart, windowEnd)

  // Every staff member with any available time on `dateStr` (leave already
  // reconciled in), one color per person, threaded sequentially so two
  // people shown back-to-back never share a color. Windows are clipped to
  // the store's open/close hours ("員工的色條也是要在營業時間內"), while
  // `desc` comes from the UNCLIPPED availability so the tooltip/popup reads
  // "All day available" / "Before 2:00 PM" / explicit ranges.
  let prevColor = null
  const people = sorted
    .map((s) => {
      const entry = availabilityByProfile?.[s.id]?.[dateStr]
      const leaveWindows = leavesOnDate(leavesByProfile, s.id, dateStr)
      const windows = availableWindowsWithLeave(entry?.dayRow, entry?.windows, leaveWindows)
        .map((w) => ({ start: Math.max(w.start, windowStart), end: Math.min(w.end, windowEnd) }))
        .filter((w) => w.end > w.start)
      if (!windows.length) return null
      const desc = describeDayWithLeave(entry?.dayRow, entry?.windows, leaveWindows)
      const color = pickColor(s.id, prevColor)
      prevColor = color
      return { profile: s, windows, desc, color }
    })
    .filter(Boolean)

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        wide
        title={`Available — ${format(parseISO(dateStr), 'EEE d MMM yyyy')}`}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        {availabilityLoading(sorted, availabilityByProfile) ? (
          <LoadingSpinner />
        ) : !people.length ? (
          <p className="text-sm text-gray-400">No one available this day.</p>
        ) : (
          <>
            <p className="text-xs text-gray-400">{people.length} available</p>
            <DayTimeline
              people={people}
              windowStart={windowStart}
              span={span}
              ticks={ticks}
              onTapPerson={(profile, desc) => setMobileDetail({ profile, desc })}
            />
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
            <span className="font-medium text-gray-500">{format(parseISO(dateStr), 'EEE d MMM')}: </span>
            {mobileDetail.desc}
          </p>
        </Modal>
      )}
    </>
  )
}

// `shiftSummary` is the already-rendered "scheduled shifts + week total"
// body (RosterEntryGrid owns the roster entries it's built from).
export function PersonAvailabilityModal({
  open,
  onClose,
  profileId,
  name,
  weekDates,
  staff,
  availabilityByProfile,
  leavesByProfile,
  shiftSummary,
}) {
  const [tab, setTab] = useState('availability')

  useEffect(() => {
    if (open) setTab('availability')
  }, [open, profileId])

  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${name}'s week`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="mb-3 flex gap-2">
        <TabButton active={tab === 'availability'} onClick={() => setTab('availability')}>
          Availability
        </TabButton>
        <TabButton active={tab === 'shift'} onClick={() => setTab('shift')}>
          Shift summary
        </TabButton>
      </div>

      {tab === 'shift' ? (
        shiftSummary
      ) : availabilityLoading(staff, availabilityByProfile) ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-2">
          {weekDates.map((dateStr) => {
            const entry = availabilityByProfile?.[profileId]?.[dateStr]
            const desc = describeDayWithLeave(entry?.dayRow, entry?.windows, leavesOnDate(leavesByProfile, profileId, dateStr))
            return (
              <div key={dateStr} className="flex items-center justify-between rounded-lg border border-brand-100 px-3 py-2">
                <div>
                  <div className="text-sm font-semibold text-gray-800">{dayShort(dateStr)}</div>
                  <div className="text-xs text-gray-400">{format(parseISO(dateStr), 'd MMM')}</div>
                </div>
                <div className={`text-right text-sm ${desc === 'Unavailable' ? 'text-red-600' : 'text-gray-700'}`}>{desc}</div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
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
  // { id, x, w } | null — x is the mouse's offset inside that person's bar
  // row and w the row's width, so the tooltip can sit right next to the
  // pointer (Jeff, 2026-11-02: the detail popup used to be pinned to the
  // far-left edge of the row no matter where on the color bar you hovered).
  const [hover, setHover] = useState(null)
  const trackHover = (id) => (e) => {
    const rect = e.currentTarget.parentElement.getBoundingClientRect()
    setHover({ id, x: e.clientX - rect.left, w: rect.width })
  }

  return (
    <div className="mt-2">
      {/* Desktop: horizontal. Jeff, 2026-10-27: "名字顯示在色條上，不要放
          在最前面" — the person's name is drawn inside their own color
          segment instead of a separate leading label column, so there's no
          "放在最前面" name column at all now. */}
      <div className="hidden sm:block">
        <div className="relative mb-1 h-3 text-[10px] text-gray-400">
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
        <div className="space-y-1">
          {people.map(({ profile, windows, desc, color }) => (
            <div key={profile.id} className="relative h-7 rounded-md border border-gray-200 bg-gray-50">
              {ticks.slice(1, -1).map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 border-l border-gray-200"
                  style={{ left: `${((t - windowStart) / span) * 100}%` }}
                />
              ))}
              {windows.map((w, i) => (
                // Jeff, 2026-10-27: "色條太窄時名字還是完整顯示，只是超過的
                // 部分跑到色條外" — no overflow-hidden/truncate here on
                // purpose: a narrow segment still shows the whole name, it
                // just spills past the colored box's own edge instead of
                // being clipped with an ellipsis.
                <div
                  key={i}
                  className="absolute top-0.5 bottom-0.5 flex items-center whitespace-nowrap rounded px-1.5 text-[11px] font-semibold text-white"
                  style={{
                    left: `${((w.start - windowStart) / span) * 100}%`,
                    width: `${((w.end - w.start) / span) * 100}%`,
                    minWidth: '6px',
                    backgroundColor: color,
                  }}
                  onMouseEnter={trackHover(profile.id)}
                  onMouseMove={trackHover(profile.id)}
                  onMouseLeave={() => setHover((cur) => (cur?.id === profile.id ? null : cur))}
                >
                  {rosterDisplayName(profile)}
                </div>
              ))}
              {hover?.id === profile.id && (
                // Centered on the pointer, but clamped so a hover near either
                // end of the bar doesn't push the tooltip outside the modal.
                <div
                  className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[11px] text-white shadow"
                  style={{ left: Math.min(Math.max(hover.x, 60), Math.max(hover.w - 60, 60)) }}
                >
                  {desc}
                </div>
              )}
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
            {/* Jeff, 2026-10-27: "手機版by date可以做到名字在色條裡但也直
                的寫嗎? 因為現在放在最下面其實看不是很清楚" — the name is
                now written vertically inside each person's own segment
                (writing-mode, so it's the whole word turned sideways rather
                than one letter per line), same place desktop shows it, so
                there's no separate legend row to lose track of which color
                is whose. overflow stays visible — a short segment still
                shows the full name, it just extends past the segment the
                same way a narrow desktop bar does. */}
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
                      className="absolute left-0 right-0 flex items-center justify-center overflow-visible rounded text-[11px] font-semibold leading-none text-white"
                      style={{
                        top: `${((w.start - windowStart) / span) * 100}%`,
                        height: `${((w.end - w.start) / span) * 100}%`,
                        minHeight: '4px',
                        backgroundColor: color,
                      }}
                    >
                      <span className="whitespace-nowrap" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                        {rosterDisplayName(profile)}
                      </span>
                    </div>
                  ))}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
