import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { NON_PICKABLE_STAFF_ROLES } from '../../../lib/permissions'
import { isActiveStoreMember } from '../../../lib/storeVisibility'
import { formatMinutes } from '../../../lib/attendance'
import {
  getStaffTimeDiscrepancies,
  isUnreadDiscrepancy,
  markTimeDiscrepancySeen,
  DISCREPANCY_WINDOW_DAYS,
} from '../../../lib/timeDiscrepancy'
import AttendanceLogTable from '../../dashboard/time-attendance/AttendanceLogTable'

// Manager-facing view of the same Attendance Logs table each employee sees
// for themselves under My Dashboard > Time & Attendance — a manager just
// picks who to look at first. Staff list follows the same "via user_stores,
// not primary_store_id" pattern as Staff Information, so someone assigned
// to more than one store shows up here at each of them.
export default function StaffTimeLogsPage() {
  const { profile, currentStoreId, accessibleStores, refreshTimeDiscrepancies } = useAuth()
  // Admin/developer can correct punches at any store (is_admin() bypasses
  // the store check at the RLS layer — see migration 0062), so they get no
  // store narrowing on the "+ Add record" picker (editorAccessibleStoreIds
  // stays null). A shop_manager can only ever write punches at a store
  // they're themselves assigned to, AND only once explicitly granted the
  // "Edit attendance logs" permission (profile.can_edit_attendance_logs —
  // see UserDetailModal.jsx; off by default per Jeff).
  const isAdmin = profile?.role === 'admin' || profile?.role === 'developer'
  const canEdit = isAdmin || (profile?.role === 'shop_manager' && !!profile?.can_edit_attendance_logs)
  const editor = profile ? { id: profile.id, name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email } : null
  const editorAccessibleStoreIds = isAdmin ? null : accessibleStores.map((s) => s.id)
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  // Jeff, 2026-09: "如果有員工的time logs算出的時間跟班表上算出來的時間的
  // 有出入15mins以上，該員名字會顯示提示" — `discrepancies` is keyed by
  // profile id, `viewedAtBySubject` is THIS viewer's own read cursor per
  // subject (time_discrepancy_views) — see src/lib/timeDiscrepancy.js for
  // how "unread" is decided from the two together.
  const [discrepancies, setDiscrepancies] = useState({})
  const [viewedAtBySubject, setViewedAtBySubject] = useState(new Map())

  useEffect(() => {
    if (!currentStoreId) return
    let active = true
    setLoading(true)
    setSelected(null)
    setSearch('')
    supabase
      .from('user_stores')
      .select('profiles(*)')
      .eq('store_id', currentStoreId)
      .then(({ data }) => {
        if (!active) return
        const rows = (data ?? [])
          .map((m) => m.profiles)
          // Join store activity unchecked at this (additional) store —
          // migration 0064, isActiveStoreMember — same reasoning as Staff
          // Information/Learning Tracker.
          .filter((p) => p && p.is_active && !NON_PICKABLE_STAFF_ROLES.includes(p.role) && isActiveStoreMember(p, currentStoreId))
          .sort((a, b) => (a.first_name ?? '').localeCompare(b.first_name ?? ''))
        setStaff(rows)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [currentStoreId])

  useEffect(() => {
    if (!currentStoreId || !profile?.id || !staff.length) {
      setDiscrepancies({})
      setViewedAtBySubject(new Map())
      return
    }
    let active = true
    const staffIds = staff.map((s) => s.id)
    ;(async () => {
      const [d, { data: viewRows }] = await Promise.all([
        getStaffTimeDiscrepancies(currentStoreId, staffIds),
        supabase.from('time_discrepancy_views').select('subject_profile_id, viewed_at').eq('viewer_id', profile.id).in('subject_profile_id', staffIds),
      ])
      if (!active) return
      setDiscrepancies(d)
      setViewedAtBySubject(new Map((viewRows ?? []).map((r) => [r.subject_profile_id, r.viewed_at])))
    })()
    return () => {
      active = false
    }
    // staff is a new array reference every load() — length + currentStoreId
    // is what actually determines whether this needs to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStoreId, profile?.id, staff.length])

  function selectStaff(s) {
    setSelected(s)
    if (discrepancies[s.id] && isUnreadDiscrepancy(discrepancies[s.id], viewedAtBySubject.get(s.id))) {
      const now = new Date().toISOString()
      setViewedAtBySubject((prev) => new Map(prev).set(s.id, now))
      markTimeDiscrepancySeen(profile.id, s.id).then(() => refreshTimeDiscrepancies?.())
    }
  }

  const query = search.trim().toLowerCase()
  const filtered = query
    ? staff.filter((s) => `${s.first_name ?? ''} ${s.last_name ?? ''}`.toLowerCase().includes(query))
    : staff

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Staff Time Logs</h1>
      <p className="mb-4 text-sm text-gray-500">Pick a staff member to view their clock in/out history.</p>

      {loading ? (
        <LoadingSpinner />
      ) : !staff.length ? (
        <EmptyState label="No active staff at this store yet." />
      ) : (
        <>
          <input
            type="text"
            className="input mb-3"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!filtered.length ? (
            <EmptyState label="No staff match that search." />
          ) : (
            <div className="mb-5 divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
              {filtered.map((s) => {
                const unread = discrepancies[s.id] && isUnreadDiscrepancy(discrepancies[s.id], viewedAtBySubject.get(s.id))
                return (
                  <button
                    key={s.id}
                    onClick={() => selectStaff(s)}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50 ${
                      selected?.id === s.id ? 'bg-brand-50' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium text-gray-800">
                      {unread && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-red-500"
                          title="Clocked time differs from rostered time — click to see details"
                        />
                      )}
                      {s.first_name} {s.last_name}
                    </span>
                    <span className="text-gray-300">›</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {selected && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-brand-700">
            {selected.first_name} {selected.last_name}
          </h2>

          {/* "點擊名字進去後會顯示出入的資訊是什麼" — every flagged day in
              the window, regardless of read/unread (opening this is what
              clears the red dot above, but the detail itself stays visible
              on repeat visits, same as the Attendance Logs table below it). */}
          {discrepancies[selected.id]?.days?.length > 0 && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="mb-2 text-sm font-semibold text-red-700">
                Clocked time differs from rostered time by 15+ minutes on {discrepancies[selected.id].days.length}{' '}
                {discrepancies[selected.id].days.length === 1 ? 'day' : 'days'} (last {DISCREPANCY_WINDOW_DAYS} days):
              </p>
              <ul className="space-y-1 text-sm text-red-700">
                {discrepancies[selected.id].days.map((d) => (
                  <li key={d.date} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{format(parseISO(d.date), 'EEE, MMM d')}</span>
                    <span>
                      Rostered {formatMinutes(d.scheduledMinutes)} · Clocked {formatMinutes(d.actualMinutes)} ·{' '}
                      <span className="font-medium">
                        {d.diffMinutes > 0 ? '+' : ''}
                        {formatMinutes(Math.abs(d.diffMinutes))} {d.diffMinutes > 0 ? 'more' : 'less'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <AttendanceLogTable
            profileId={selected.id}
            canEdit={canEdit}
            editor={editor}
            editorAccessibleStoreIds={editorAccessibleStoreIds}
          />
        </div>
      )}
    </div>
  )
}
