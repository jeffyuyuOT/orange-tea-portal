import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

export default function EditLeaveTab() {
  const { profile } = useAuth()
  const [leaves, setLeaves] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ start_at: '', end_at: '', reason: '' })

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
    setForm({ start_at: l.start_at.slice(0, 16), end_at: l.end_at.slice(0, 16), reason: l.reason ?? '' })
  }

  async function save() {
    await supabase.from('leave_requests').update(form).eq('id', editingId)
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
              <input
                type="datetime-local"
                className="input"
                value={form.start_at}
                onChange={(e) => setForm({ ...form, start_at: e.target.value })}
              />
              <input
                type="datetime-local"
                className="input"
                value={form.end_at}
                onChange={(e) => setForm({ ...form, end_at: e.target.value })}
              />
            </div>
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
