import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { brisbaneLocalToIso, isoToBrisbaneLocal } from '../../../lib/brisbaneTime'
import LeaveDateRangeFields from './LeaveDateRangeFields'

export default function EditLeaveTab() {
  const { profile } = useAuth()
  const [leaves, setLeaves] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ start_at: '', end_at: '', reason: '' })
  // Jeff, 2026-10-02: "edit時勾取specific time的選項取消，就做得跟申請時一樣"
  // — same checkbox as Apply Leave (LeaveDateRangeFields.jsx). Starting an
  // edit infers its initial state from the stored times themselves: a
  // leave that's exactly 00:00–23:59 (whole day, Apply Leave's own
  // default) opens with it unchecked; anything else opens with it checked,
  // since it was clearly entered with specific times in mind.
  const [specificTime, setSpecificTime] = useState(false)

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
    // Jeff, 2026-10-02: used to be `l.start_at.slice(0, 16)` — stored
    // start_at/end_at are real UTC timestamps, so slicing the raw string
    // showed the wrong (UTC, not Brisbane) wall-clock time the moment the
    // UTC offset crossed a day boundary — the exact "end time becomes next
    // day's morning" bug. isoToBrisbaneLocal does the proper conversion
    // (see brisbaneTime.js).
    const start_at = isoToBrisbaneLocal(l.start_at)
    const end_at = isoToBrisbaneLocal(l.end_at)
    setForm({ start_at, end_at, reason: l.reason ?? '' })
    setSpecificTime(!(start_at.endsWith('T00:00') && end_at.endsWith('T23:59')))
  }

  async function save() {
    if (form.end_at < form.start_at) {
      alert('End date/time can’t be before the start.')
      return
    }
    await supabase
      .from('leave_requests')
      .update({ start_at: brisbaneLocalToIso(form.start_at), end_at: brisbaneLocalToIso(form.end_at), reason: form.reason })
      .eq('id', editingId)
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
            <LeaveDateRangeFields
              startAt={form.start_at}
              endAt={form.end_at}
              specificTime={specificTime}
              onChange={(next) => {
                setForm({ ...form, start_at: next.startAt, end_at: next.endAt })
                setSpecificTime(next.specificTime)
              }}
            />
            {form.end_at < form.start_at && <p className="text-sm text-red-600">End date/time can’t be before the start.</p>}
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <div className="flex gap-2">
              <Button onClick={save} disabled={form.end_at < form.start_at}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div key={l.id} className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm font-medium text-gray-800">
                {new Date(l.start_at).toLocaleString()} – {new Date(l.end_at).toLocaleString()}
              </div>
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
