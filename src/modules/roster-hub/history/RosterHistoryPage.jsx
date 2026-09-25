import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { exportRosterGrid, timeToDecimal, rosterDisplayName } from '../../../lib/excelRoster'
import MultiStoreExportModal from './MultiStoreExportModal'

export default function RosterHistoryPage() {
  const { currentStoreId, profile, accessibleStores } = useAuth()
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? ''
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [showMultiExport, setShowMultiExport] = useState(false)
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
    // fetch it alongside the membership row and fold it back onto each
    // profile object so rosterDisplayName() (which just reads
    // `.roster_display_name`) doesn't need to know where it came from.
    const [{ data: rows }, { data: memberships }] = await Promise.all([
      supabase.from('roster_entries').select('*, profiles(first_name, last_name)').eq('roster_period_id', period.id),
      supabase.from('user_stores').select('profile_id, roster_display_name, profiles(id, first_name, last_name, is_active)').eq('store_id', currentStoreId),
    ])
    const nameByProfile = new Map((memberships ?? []).map((m) => [m.profile_id, m.roster_display_name]))
    const staffList = (memberships ?? [])
      .filter((m) => m.profiles?.is_active)
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">History</h1>
          <p className="text-sm text-gray-500">Every saved and submitted roster for this store.</p>
        </div>
        {profile?.role === 'admin' && accessibleStores.length > 1 && (
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
              </div>
            </div>
          ))}
        </div>
      )}

      {showMultiExport && <MultiStoreExportModal onClose={() => setShowMultiExport(false)} />}
    </div>
  )
}
