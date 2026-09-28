import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName } from '../../../lib/excelRoster'
import { weekDatesFrom, loadWeekAvailabilityForProfiles, describeDay } from '../../../lib/availability'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Jeff, 2026-09: "在roster hub上的manage roster的action旁邊新增view staff's
// availability，點擊則會跳出視窗顯示編排該週員工登記的available time，以清單
// 方式全部顯示，不需要再做任何點擊" — read-only, everyone's whole week shown
// flat, no per-person expand/click needed. Staff with nothing saved for a
// day just read "All day available" (the same default computeAvailableWindows
// falls back to when there's no row), so this list is complete for every
// staff member on the roster, not just the ones who've actually filled
// something in.
export default function StaffAvailabilityModal({ open, onClose, staff, weekStart }) {
  const [byProfile, setByProfile] = useState(null)

  useEffect(() => {
    if (!open) return
    setByProfile(null)
    loadWeekAvailabilityForProfiles(
      staff.map((s) => s.id),
      weekStart
    ).then(setByProfile)
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
        <div className="space-y-4">
          {sorted.map((s) => (
            <div key={s.id} className="rounded-lg border border-brand-100 p-3">
              <div className="mb-1.5 text-sm font-semibold text-gray-800">{rosterDisplayName(s)}</div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-7">
                {dates.map((dateStr, i) => {
                  const entry = byProfile[s.id]?.[dateStr]
                  const desc = describeDay(entry?.dayRow, entry?.windows)
                  return (
                    <div key={dateStr}>
                      <span className="text-xs font-medium text-gray-400">{DAY_LABELS[i]} {format(parseISO(dateStr), 'd/M')}</span>
                      <div className={desc === 'Unavailable' ? 'text-red-600' : 'text-gray-700'}>{desc}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
