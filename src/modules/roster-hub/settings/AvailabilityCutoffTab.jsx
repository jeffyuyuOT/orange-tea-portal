import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { WEEKDAY_NAMES, APPROVER_ROLES, formatClock } from '../../../lib/scheduleLock'

// Jeff, 2026-11-27: replaces the old "Message reminder" tab. Per store:
//  - the weekly CUT-OFF (weekday + time, Brisbane) for staff changing NEXT week's availability;
//  - who approves a change once the cut-off has passed (or the week's roster is already submitted).
// The reminder Message to staff now goes out the day BEFORE the cut-off (migration 0170).
export default function AvailabilityCutoffTab() {
  const { currentStoreId } = useAuth()
  const [weekday, setWeekday] = useState(5)
  const [time, setTime] = useState('23:59')
  const [approverId, setApproverId] = useState('')
  const [saved, setSaved] = useState({ weekday: 5, time: '23:59', approverId: '' })
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentStoreId) return
    let cancelled = false
    setLoading(true)
    setJustSaved(false)
    setError('')
    ;(async () => {
      const [{ data: store, error: err }, { data: memberRows }, { data: primaryRows }, { data: adminRows }] = await Promise.all([
        supabase
          .from('stores')
          .select('availability_cutoff_weekday, availability_cutoff_time, availability_approver_id')
          .eq('id', currentStoreId)
          .single(),
        supabase.from('user_stores').select('profiles(id, first_name, last_name, role, is_active)').eq('store_id', currentStoreId),
        supabase.from('profiles').select('id, first_name, last_name, role, is_active').eq('primary_store_id', currentStoreId),
        supabase.from('profiles').select('id, first_name, last_name, role, is_active').in('role', ['admin', 'developer']),
      ])
      if (cancelled) return
      if (err) setError(err.message)
      const byId = new Map()
      ;[...(memberRows ?? []).map((r) => r.profiles), ...(primaryRows ?? []), ...(adminRows ?? [])].forEach((p) => {
        if (p && p.is_active && APPROVER_ROLES.includes(p.role)) byId.set(p.id, p)
      })
      setCandidates(
        Array.from(byId.values()).sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
      )
      const wd = store?.availability_cutoff_weekday ?? 5
      const tm = String(store?.availability_cutoff_time ?? '23:59').slice(0, 5)
      const ap = store?.availability_approver_id ?? ''
      setWeekday(wd)
      setTime(tm)
      setApproverId(ap)
      setSaved({ weekday: wd, time: tm, approverId: ap })
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [currentStoreId])

  async function save() {
    if (!time) {
      setError('Please pick a cut-off time.')
      return
    }
    setSaving(true)
    setJustSaved(false)
    setError('')
    const { error: err } = await supabase.rpc('set_availability_cutoff', {
      p_store_id: currentStoreId,
      p_weekday: Number(weekday),
      p_time: time,
      p_approver: approverId || null,
    })
    setSaving(false)
    if (err) return setError(err.message)
    setSaved({ weekday: Number(weekday), time, approverId })
    setJustSaved(true)
  }

  if (loading) return null

  const dirty = Number(weekday) !== saved.weekday || time !== saved.time || approverId !== saved.approverId
  const reminderDay = WEEKDAY_NAMES[(Number(weekday) + 6) % 7]

  return (
    <div className="max-w-lg rounded-xl border border-brand-100 bg-white p-4">
      <p className="mb-3 text-sm text-gray-500">
        The cut-off is the deadline (Brisbane time) for staff to enter or change <b>next week's</b> availability
        themselves. Staff can't change availability on their own when:
      </p>
      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-gray-500">
        <li>they are changing next week's availability after this week's cut-off, or</li>
        <li>the roster for the week they want to change has already been submitted (leave requests too).</li>
      </ul>
      <p className="mb-4 text-sm text-gray-500">
        In both cases the change waits for the approver below — a pop-up appears for them when they open the app, and
        the staff member sees "Waiting for manager approval" until it is confirmed.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Cut-off day</span>
          <select
            className="input"
            value={weekday}
            onChange={(e) => {
              setWeekday(Number(e.target.value))
              setJustSaved(false)
            }}
          >
            {WEEKDAY_NAMES.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Cut-off time</span>
          <input
            type="time"
            step="900"
            className="input"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              setJustSaved(false)
            }}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Approver (manager or above)</span>
        <select
          className="input"
          value={approverId}
          onChange={(e) => {
            setApproverId(e.target.value)
            setJustSaved(false)
          }}
        >
          <option value="">— Not set —</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()} ({p.role})
            </option>
          ))}
        </select>
      </label>
      {!approverId && (
        <p className="mt-1 text-xs text-amber-600">
          No approver set — staff can't submit changes after the cut-off until you pick someone.
        </p>
      )}

      <p className="mt-4 text-xs text-gray-400">
        Reminder: staff who still haven't entered next week's availability get a System Message at 9am on{' '}
        <b>{reminderDay}</b> (the day before the cut-off). Staff with "Lock time pattern" checked are never reminded.
      </p>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {justSaved && (
          <span className="text-xs text-green-600">
            Saved — cut-off {WEEKDAY_NAMES[saved.weekday]} {formatClock(saved.time)}.
          </span>
        )}
        {!justSaved && dirty && <span className="text-xs text-amber-600">Not saved yet — press Save.</span>}
      </div>
    </div>
  )
}
