import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Jeff, 2026-10-21 (point 1): "Roster hub裡的setting裡新增message reminder分
// 頁，裡面可以設置禮拜幾之前員工如果沒有apply下禮拜的available time會收到系
// 統訊息提醒。之前是預設禮拜四，現在統一由這裡設定(不同分店會有不同的設定)，
// 一樣有勾取lock time pattern的員工不會收到訊息" — replaces the old hardcoded
// Thursday (migration 0084) with a per-store pick, stored on
// stores.availability_reminder_weekday (migration 0129). The server-side
// cron job now runs every day and checks each profile's own store against
// this setting — see that migration for the SQL side. Someone with "Lock
// time pattern" checked on My Availability is unaffected either way: their
// next week gets auto-copied in before this check ever runs (migrations
// 0087/0088), same as before this tab existed.
export default function MessageReminderTab() {
  const { currentStoreId } = useAuth()
  const [weekday, setWeekday] = useState(4)
  // The value actually stored in the database (what a reload would show).
  const [savedWeekday, setSavedWeekday] = useState(4)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentStoreId) return
    setLoading(true)
    setSaved(false)
    setError('')
    supabase
      .from('stores')
      .select('availability_reminder_weekday')
      .eq('id', currentStoreId)
      .single()
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        setWeekday(data?.availability_reminder_weekday ?? 4)
        setSavedWeekday(data?.availability_reminder_weekday ?? 4)
        setLoading(false)
      })
  }, [currentStoreId])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError('')
    // Jeff, 2026-10-26: "改了日期，重新登入後又跳回禮拜四" — a shop manager's
    // direct UPDATE on stores matched no row (only admin/developer can write
    // stores) yet looked like success. This goes through a narrow database
    // function instead (migration 0151: admin/developer, or a shop manager of
    // this store) and only shows "Saved." when it really took effect.
    const { data: newDay, error: err } = await supabase.rpc('set_availability_reminder_weekday', {
      p_store_id: currentStoreId,
      p_weekday: Number(weekday),
    })
    setSaving(false)
    if (err) return setError(err.message)
    const data = [{ availability_reminder_weekday: newDay }]
    setSavedWeekday(data[0].availability_reminder_weekday)
    setWeekday(data[0].availability_reminder_weekday)
    setSaved(true)
  }

  if (loading) return null

  return (
    <div className="max-w-md rounded-xl border border-brand-100 bg-white p-4">
      <p className="mb-4 text-sm text-gray-500">
        Staff who still haven't entered their availability for next week by 9am (Brisbane time) on the chosen day get
        a System Message reminding them to fill in My Availability. Someone with "Lock time pattern" checked (My
        Availability) never triggers this — their next week is auto-copied in before this check runs.
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Remind on</span>
        <select className="input" value={weekday} onChange={(e) => {
            setWeekday(e.target.value)
            setSaved(false)
          }}>
          {WEEKDAYS.map((d, i) => (
            <option key={i} value={i}>
              {d}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-xs text-green-600">Saved — reminders go out on {WEEKDAYS[savedWeekday]}.</span>}
        {!saved && Number(weekday) !== savedWeekday && (
          <span className="text-xs text-amber-600">Not saved yet — press Save (currently {WEEKDAYS[savedWeekday]}).</span>
        )}
      </div>
    </div>
  )
}
