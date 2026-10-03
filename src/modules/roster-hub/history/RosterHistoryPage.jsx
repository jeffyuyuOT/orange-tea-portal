import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { exportRosterGrid, timeToDecimal, rosterDisplayName } from '../../../lib/excelRoster'
import { NON_ROSTER_STAFF_ROLES } from '../../../lib/permissions'
import { isActiveStoreMember } from '../../../lib/storeVisibility'
import MultiStoreExportModal from './MultiStoreExportModal'

export default function RosterHistoryPage() {
  const { currentStoreId, profile, accessibleStores } = useAuth()
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? ''
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [showMultiExport, setShowMultiExport] = useState(false)
  // Jeff, 2026-10-03: "history的紀錄新增刪除選項，如果是已經publish的要刪除
  //前會跳出警告圖示確認" — a Delete option on each saved/published week.
  // `deleteTarget` is whichever period row the manager just clicked Delete
  // on (null when the confirm popup is closed); its own `status` decides
  // which confirm copy renders below — a submitted (already-published) week
  // gets the strong ⚠️ warning since staff may already have seen their
  // shifts for it, a draft just gets a plain "are you sure".
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!currentStoreId) return
    setLoading(true)
    supabase
      .from('roster_periods')
      .select('*')
      .eq('store_id', currentStoreId)
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        setPeriods(data ?? [])
        setLoading(false)
      })
  }, [currentStoreId])

  async function exportPeriod(period) {
    // roster_display_name is per-store (user_stores), not on profiles —
    // fold it back onto each profile object so rosterDisplayName() (which
    // just reads `.roster_display_name`) doesn't need to know where it
    // came from.
    const [{ data: rows }, { data: memberships }] = await Promise.all([
      supabase.from('roster_entries').select('*, profiles(first_name, last_name)').eq('roster_period_id', period.id),
      supabase
        .from('user_stores')
        .select(
          'profile_id, roster_display_name, roster_order, hidden_from_roster, profiles(id, first_name, last_name, is_active, role, primary_store_id, join_store_activity)'
        )
        .eq('store_id', currentStoreId)
        .order('roster_order'),
    ])
    const nameByProfile = new Map((memberships ?? []).map((m) => [m.profile_id, m.roster_display_name]))
    // Exported "blank" rows for staff with no shift that week come from this
    // list too, so keep it in step with Manage Roster: training/qr_code_maker
    // accounts don't get scheduled and shouldn't show up in the export
    // either, nor should anyone currently hidden from the roster (Roster
    // Hub > Setting > Roster Staff Order) — same reasoning: they're not
    // being scheduled right now, so a blank row for them here would be
    // just as misleading as one on the live grid. Same for Join store
    // activity unchecked at this (additional) store (migration 0064).
    const staffList = (memberships ?? [])
      .filter(
        (m) =>
          m.profiles?.is_active &&
          !NON_ROSTER_STAFF_ROLES.includes(m.profiles.role) &&
          !m.hidden_from_roster &&
          isActiveStoreMember(m.profiles, currentStoreId)
      )
      .map((m) => ({ ...m.profiles, roster_display_name: m.roster_display_name }))
    const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(period.week_start_date), i), 'yyyy-MM-dd'))
    const entries = (rows ?? []).map((r) => ({
      profileId: r.profile_id ?? '',
      staffName: r.profiles
        ? rosterDisplayName({ ...r.profiles, roster_display_name: nameByProfile.get(r.profile_id) })
        : r.staff_name_raw ?? '',
      date: r.work_date,
      startTime: timeToDecimal(r.start_time),
      endTime: timeToDecimal(r.end_time),
      breakHours: r.break_half_hours ?? '',
    }))
    exportRosterGrid(storeName, staffList, weekDates, entries, `roster-${period.week_start_date}-${period.status}.xlsx`)
  }

  // roster_entries.roster_period_id is `on delete cascade` (0001_init.sql),
  // so deleting the roster_periods row alone is enough — no separate
  // roster_entries cleanup needed here.
  async function confirmDelete() {
    const period = deleteTarget
    setDeleting(true)
    const { error } = await supabase.from('roster_periods').delete().eq('id', period.id)
    setDeleting(false)
    if (error) {
      alert(`Delete failed: ${error.message}`)
      return
    }
    setPeriods((prev) => prev.filter((p) => p.id !== period.id))
    setDeleteTarget(null)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">History</h1>
          <p className="text-sm text-gray-500">Every saved and submitted roster for this store.</p>
        </div>
        {/* Jeff, 2026-09: developer is meant to be admin's superset — this
            multi-store export button only ever checked the literal 'admin'
            role. */}
        {(profile?.role === 'admin' || profile?.role === 'developer') && accessibleStores.length > 1 && (
          <Button variant="secondary" onClick={() => setShowMultiExport(true)}>
            Export multiple stores
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !periods.length ? (
        <EmptyState label="No roster history yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {periods.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">
                    {p.week_start_date} → {p.week_end_date}
                  </span>
                  <Badge color={p.status === 'submitted' ? 'green' : 'gray'}>
                    {p.status === 'submitted' ? '已完成' : '未提交'}
                  </Badge>
                </div>
                <div className="text-xs text-gray-400">Saved {new Date(p.updated_at ?? p.created_at).toLocaleString()}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => navigate('/roster-hub/manage-roster', { state: { loadPeriodId: p.id } })}>
                  Load
                </Button>
                <Button variant="secondary" onClick={() => exportPeriod(p)}>
                  Export
                </Button>
                <Button variant="danger" onClick={() => setDeleteTarget(p)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showMultiExport && <MultiStoreExportModal onClose={() => setShowMultiExport(false)} />}

      {/* Jeff, 2026-10-03: a submitted (already-published) week gets the
          strong ⚠️ warning copy — staff may have already seen their shifts
          for it — while a draft gets a plain confirm; both share this same
          modal, just different title/body/icon below. */}
      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title={deleteTarget.status === 'submitted' ? 'Delete a published roster?' : 'Delete this draft?'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </>
          }
        >
          {deleteTarget.status === 'submitted' ? (
            <div className="flex gap-3">
              <span className="text-3xl" aria-hidden="true">⚠️</span>
              <p className="text-sm text-gray-700">
                This roster for <strong>{deleteTarget.week_start_date} → {deleteTarget.week_end_date}</strong> was
                already published — staff may have already seen their shifts for this week. Deleting it permanently
                removes the whole week's roster and cannot be undone. This does not notify staff of the removal.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-700">
              Permanently delete the draft roster for <strong>{deleteTarget.week_start_date} → {deleteTarget.week_end_date}</strong>?
              This cannot be undone.
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
