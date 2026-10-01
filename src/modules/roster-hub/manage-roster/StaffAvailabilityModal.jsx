import { useEffect, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName } from '../../../lib/excelRoster'
import { weekDatesFrom, loadWeekAvailabilityForProfiles, describeDayWithLeave, leaveWindowOnDate } from '../../../lib/availability'

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
export default function StaffAvailabilityModal({ open, onClose, staff, weekStart }) {
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

  function toggleExpanded(profileId) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
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

  if (!open) return null

  const dates = weekDatesFrom(weekStart)
  const sorted = [...staff].sort((a, b) => rosterDisplayName(a).localeCompare(rosterDisplayName(b)))

  return (
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
      ) : !sorted.length ? (
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
                          <span className="text-xs font-medium text-gray-400">{DAY_LABELS[i]} {format(parseISO(dateStr), 'd/M')}</span>
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
      )}
    </Modal>
  )
}
