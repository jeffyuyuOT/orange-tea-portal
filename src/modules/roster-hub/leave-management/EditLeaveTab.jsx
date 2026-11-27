import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { brisbaneLocalToIso, isoToBrisbaneLocal } from '../../../lib/brisbaneTime'
import LeaveDateRangeFields from './LeaveDateRangeFields'
import {
  isApprovalExempt,
  storesWithSubmittedRoster,
  loadStoreCutoff,
  createChangeRequest,
  cancelChangeRequest,
  notifyLeaveChange,
} from '../../../lib/scheduleLock'

export default function EditLeaveTab() {
  const { profile, accessibleStores } = useAuth()
  // Jeff, 2026-11-21: Apply Leave can now register the same leave at several
  // shops (one row per shop). They're listed as ONE leave here (same
  // start/end/reason), and Edit/Cancel act on every copy so shops never drift.
  const [leaves, setLeaves] = useState([])
  // Jeff, 2026-11-27: leave applied/changed inside an already-submitted roster waits for the approver.
  const [pending, setPending] = useState([])
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
    const groups = new Map()
    ;(data ?? []).forEach((l) => {
      const key = `${l.start_at}|${l.end_at}|${l.reason ?? ''}`
      const g = groups.get(key)
      if (g) {
        g.ids.push(l.id)
        g.storeIds.push(l.store_id)
      } else groups.set(key, { ...l, ids: [l.id], storeIds: [l.store_id] })
    })
    setLeaves(Array.from(groups.values()))
    const { data: pend } = await supabase
      .from('schedule_change_requests')
      .select('*')
      .eq('profile_id', profile.id)
      .eq('status', 'pending')
      .in('kind', ['leave_new', 'leave_edit'])
      .order('created_at')
    setPending(pend ?? [])
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
    const group = leaves.find((l) => l.id === editingId)
    const ids = group?.ids ?? [editingId]
    const storeIds = group?.storeIds ?? []
    // Jeff, 2026-11-27: a change that lands inside an already-submitted roster needs the approver's OK
    // (ids[i] belongs to storeIds[i] — see load()).
    const needApproval = isApprovalExempt(profile) ? new Set() : await storesWithSubmittedRoster(storeIds, form.start_at, form.end_at)
    const directIds = ids.filter((_, i) => !needApproval.has(storeIds[i]))
    const waitingIds = ids.filter((_, i) => needApproval.has(storeIds[i]))
    const patch = { start_at: brisbaneLocalToIso(form.start_at), end_at: brisbaneLocalToIso(form.end_at), reason: form.reason }
    const range = `${form.start_at.replace('T', ' ')} – ${form.end_at.replace('T', ' ')}`

    const notes = []
    if (waitingIds.length) {
      const waitStore = storeIds[ids.indexOf(waitingIds[0])]
      const cutoff = await loadStoreCutoff(waitStore)
      if (!cutoff?.approverId) {
        alert('This leave falls in a week whose roster is already submitted, and no approver is set for the shop yet — please ask your manager.')
        return
      }
      const { error: reqErr } = await createChangeRequest({
        profile,
        storeId: waitStore,
        approverId: cutoff.approverId,
        kind: 'leave_edit',
        reasonCode: 'roster_submitted',
        title: `Change leave to ${form.start_at.slice(0, 10)} – ${form.end_at.slice(0, 10)}`,
        details: [`New time: ${range}`, ...(form.reason ? [`Reason: ${form.reason}`] : [])],
        payload: { ids: waitingIds, startAt: patch.start_at, endAt: patch.end_at, reason: form.reason },
      })
      if (reqErr) {
        alert(reqErr.message)
        return
      }
      notes.push(`waiting for ${cutoff.approverName}`)
    }
    if (directIds.length) {
      await supabase.from('leave_requests').update(patch).in('id', directIds)
      notifyLeaveChange({
        profile,
        storeIds: directIds.map((id) => storeIds[ids.indexOf(id)]),
        text: `changed their leave to: ${range}${form.reason ? ` (${form.reason})` : ''}.`,
      })
    }
    if (notes.length) alert(`This leave is in a week whose roster is already submitted, so the change was sent for approval (${notes.join(', ')}). Your current leave stays as it is until it is approved.`)
    setEditingId(null)
    load()
  }

  async function cancel(ids) {
    const group = leaves.find((l) => l.ids === ids)
    await supabase.from('leave_requests').update({ status: 'cancelled' }).in('id', ids)
    if (group) {
      notifyLeaveChange({
        profile,
        storeIds: group.storeIds,
        text: `cancelled their leave: ${new Date(group.start_at).toLocaleString()} – ${new Date(group.end_at).toLocaleString()}.`,
      })
    }
    load()
  }

  async function withdraw(id) {
    await cancelChangeRequest(id)
    load()
  }

  if (!leaves.length && !pending.length) return <EmptyState label="You have no upcoming leave." />

  return (
    <div className="max-w-lg space-y-3">
      {pending.length > 0 && (
        <div className="divide-y divide-blue-100 rounded-xl border border-blue-200 bg-blue-50">
          {pending.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 p-3 text-sm text-blue-800">
              <div>
                <div className="font-medium">Waiting for manager approval</div>
                <div className="text-xs">{r.title}</div>
                <ul className="mt-0.5 text-xs">
                  {(r.details ?? []).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
              <Button variant="secondary" onClick={() => withdraw(r.id)}>
                Withdraw
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
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
              {l.ids.length > 1 && (
                <div className="text-xs text-gray-400">
                  Applies to: {l.storeIds.map((id) => (accessibleStores ?? []).find((s) => s.id === id)?.name ?? 'shop').join(', ')}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => startEdit(l)}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => cancel(l.ids)}>
                Cancel
              </Button>
            </div>
          </div>
        )
      )}
      </div>
    </div>
  )
}
