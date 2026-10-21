import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { timeToDecimal, dayHours, rosterDisplayName } from '../../../lib/excelRoster'

// Jeff, 2026-10-20 (point 1): "Roster hub的history每一筆資料Load的左邊新增
// summary按鈕，按了跳出視窗顯示每一個員工這段期間weekday, weekend, public
// holiday各幾個小時" — a per-employee weekday/weekend/public-holiday hours
// breakdown for one saved roster period. These are the period's SCHEDULED
// shift hours (roster_entries), not actual clock-in/out attendance — this
// is a Roster Hub feature, reading the roster the manager actually built.
//
// Public-holiday dates come from the Payroll tool's own per-store Settings
// (payroll_stores.data.publicHolidays — Developer Tools > Payroll > Store
// Settings), the only place this app already tracks them (Jeff confirmed:
// "payroll模組裡應該有Public holiday的資料"). That table's RLS used to be
// developer-only; migration 0113_payroll_stores_manager_read.sql added a
// read-only policy for shop_manager/admin too, specifically for this.
// payroll_stores rows key themselves by their OWN internal store id
// (store_23/24/25…), unrelated to this app's stores.id, so the match here
// is by store NAME instead (`storeName` prop, passed down from
// RosterHistoryPage's own `accessibleStores` lookup). A store that hasn't
// been set up in Payroll yet (no matching row) just gets no public-holiday
// bucket — every non-weekend day counts as a plain weekday, same as before
// Payroll existed.
//
// Jeff, 2026-10-21: "12/24(Christmas' Eve)號晚上6點以後也是public holiday"
// — in Queensland, Christmas Eve is only a PART-day public holiday (6pm to
// midnight); the morning/afternoon is a plain weekday (or weekend, in the
// rare year it falls on one). That's a fixed calendar rule, not something
// that varies per store or needs entering in Payroll's date list like a
// whole-day holiday does, so it's handled here directly rather than
// extending that list's data shape. A shift that spans 6pm on the 24th gets
// SPLIT proportionally (net of its break) between its normal bucket and
// Public Holiday, rather than the whole shift landing in one bucket or the
// other. If a store's Payroll settings also explicitly list 12/24 as a
// (whole-day) holiday, that takes precedence — same as any other listed
// date — since an admin who did that clearly means the whole day.
const CHRISTMAS_EVE_PUBLIC_HOLIDAY_FROM_HOUR = 18 // 6pm

function isChristmasEve(workDate) {
  return /-12-24$/.test(workDate)
}

// Returns { weekday, weekend, publicHoliday } for ONE shift, summing to its
// own dayHours() total (modulo floating-point rounding).
function bucketsForEntry(e, isWholeDayPublicHoliday) {
  const start = timeToDecimal(e.start_time)
  const end = timeToDecimal(e.end_time)
  const total = dayHours({ startTime: start, endTime: end, breakHours: e.break_half_hours })
  const buckets = { weekday: 0, weekend: 0, publicHoliday: 0 }
  if (!total) return buckets
  const dow = new Date(`${e.work_date}T00:00:00`).getDay() // 0=Sun..6=Sat
  const plainKey = dow === 0 || dow === 6 ? 'weekend' : 'weekday'

  if (isWholeDayPublicHoliday) {
    buckets.publicHoliday = total
    return buckets
  }
  const rawTotal = Number(end) - Number(start)
  if (!isChristmasEve(e.work_date) || !(rawTotal > 0)) {
    buckets[plainKey] = total
    return buckets
  }
  // Net worked hours on each side of 6pm, proportional to how much of the
  // RAW (pre-break) shift fell on each side — the break itself has no
  // recorded clock time, so this is the fairest split available.
  const rawAfterCutoff = Math.max(0, end - Math.max(start, CHRISTMAS_EVE_PUBLIC_HOLIDAY_FROM_HOUR))
  const afterShare = Math.min(1, rawAfterCutoff / rawTotal)
  buckets.publicHoliday = total * afterShare
  buckets[plainKey] = total * (1 - afterShare)
  return buckets
}

export default function RosterSummaryModal({ period, storeName, onClose }) {
  const { currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: entries }, { data: memberships }, { data: payrollStore }] = await Promise.all([
        supabase
          .from('roster_entries')
          .select('profile_id, work_date, start_time, end_time, break_half_hours, staff_name_raw')
          .eq('roster_period_id', period.id),
        supabase
          .from('user_stores')
          .select('profile_id, roster_display_name, profiles(first_name, last_name)')
          .eq('store_id', currentStoreId),
        storeName
          ? supabase.from('payroll_stores').select('data').contains('data', { name: storeName }).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return

      const nameByProfile = new Map(
        (memberships ?? []).map((m) => [m.profile_id, rosterDisplayName({ ...m.profiles, roster_display_name: m.roster_display_name })])
      )
      const publicHolidays = new Set((payrollStore?.data?.publicHolidays ?? []).map((h) => h.date))

      const totals = new Map() // profile_id (or raw name) -> { name, weekday, weekend, publicHoliday }
      ;(entries ?? []).forEach((e) => {
        const buckets = bucketsForEntry(e, publicHolidays.has(e.work_date))
        if (!buckets.weekday && !buckets.weekend && !buckets.publicHoliday) return
        const key = e.profile_id ?? `raw:${e.staff_name_raw}`
        const name = e.profile_id ? nameByProfile.get(e.profile_id) ?? '(removed staff)' : e.staff_name_raw || 'Unknown'
        if (!totals.has(key)) totals.set(key, { name, weekday: 0, weekend: 0, publicHoliday: 0 })
        const row = totals.get(key)
        row.weekday += buckets.weekday
        row.weekend += buckets.weekend
        row.publicHoliday += buckets.publicHoliday
      })

      setRows(Array.from(totals.values()).sort((a, b) => a.name.localeCompare(b.name)))
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [period.id, currentStoreId, storeName])

  const grandTotal = rows.reduce((sum, r) => sum + r.weekday + r.weekend + r.publicHoliday, 0)

  return (
    <Modal open onClose={onClose} wide title={`📊 Summary — ${period.week_start_date} → ${period.week_end_date}`}>
      {loading ? (
        <LoadingSpinner />
      ) : !rows.length ? (
        <EmptyState label="No shifts in this roster." />
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-100 text-left text-xs text-gray-500">
                <th className="py-1.5 pr-2">Name</th>
                <th className="py-1.5 pr-2 text-right">Weekday</th>
                <th className="py-1.5 pr-2 text-right">Weekend</th>
                <th className="py-1.5 pr-2 text-right">Public Holiday</th>
                <th className="py-1.5 pl-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-50">
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="py-1.5 pr-2 font-medium text-gray-800">{r.name}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-600">{r.weekday.toFixed(1)}h</td>
                  <td className="py-1.5 pr-2 text-right text-gray-600">{r.weekend.toFixed(1)}h</td>
                  <td className="py-1.5 pr-2 text-right text-gray-600">{r.publicHoliday.toFixed(1)}h</td>
                  <td className="py-1.5 pl-2 text-right font-semibold text-brand-700">
                    {(r.weekday + r.weekend + r.publicHoliday).toFixed(1)}h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 text-right text-xs text-gray-400">Store total: {grandTotal.toFixed(1)}h</div>
        </>
      )}
    </Modal>
  )
}
