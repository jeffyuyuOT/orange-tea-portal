import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { HALF_HOUR_TIMES, buildLeaveTimestamps, formatTimeLabel, leaveTooltipLabel, parseLeaveTimestamps } from './leaveDates'

export default function EditLeaveTab() {
  const { profile } = useAuth()
  const [leaves, setLeaves] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(null)

  async function load() {
    const { data } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .gt('end_at', new Date().toISOString())
      .order('start_at')
    setLeaves(data ?? [])
  }

  useEffect(() => {
    load()
  }, [profile])

  function startEdit(l) {
    setEditingId(l.id)
    setForm({ ...parseLeaveTimestamps(l.start_at, l.end_at, l.has_time), reason: l.reason ?? '' })
  }

  async function save() {
    const timestamps = buildLeaveTimestamps(form)
    await supabase.from('leave_requests').update({ ...timestamps, reason: form.reason }).eq('id', editingId)
    setEditingId(null)
    load()
  }

  async function cancel(id) {
    await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', id)
    load()
  }

  if (!leaves.length) return <EmptyState label="You have no upcoming leave." />

  return (
    <div className="max-w-lg divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
      {leaves.map((l) =>
        editingId === l.id ? (
          <div key={l.id} className="space-y-2 p-4">
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              <input type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={form.includeTime}
                onChange={(e) => setForm({ ...form, includeTime: e.target.checked })}
              />
              Specify time (leave unchecked for a whole-day leave)
            </label>
            {form.includeTime && (
              <div className="grid grid-cols-2 gap-2">
                <select className="input" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })}>
                  {HALF_HOUR_TIMES.map((t) => (
                    <option key={t} value={t}>
                      {formatTimeLabel(t)}
                    </option>
                  ))}
                </select>
                <select className="input" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })}>
                  {HALF_HOUR_TIMES.map((t) => (
                    <option key={t} value={t}>
                      {formatTimeLabel(t)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <div className="flex gap-2">
              <Button onClick={save}>Save</Button>
              <Button variant="secondary" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div key={l.id} className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm font-medium text-gray-800">{leaveTooltipLabel(l)}</div>
              {l.reason && <div className="text-xs text-gray-400">{l.reason}</div>}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => startEdit(l)}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => cancel(l.id)}>
                Cancel
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  )
}
