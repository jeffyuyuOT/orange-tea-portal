import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

// Jeff, 2026-11-27: the designated approver (Roster Hub > Setting > Availability Cut-off Settings)
// gets this pop-up on login / when the app comes back to the front whenever staff have availability or
// leave changes waiting for them: who wants to change what, to what. Approve applies the change
// (decide_schedule_change(), migration 0170); Reject leaves everything as it was. Either way the
// staff member gets a Message.
const RECHECK_GAP_MS = 10 * 60 * 1000

export default function ScheduleApprovalModal({ profile }) {
  const [items, setItems] = useState([])
  const [dismissed, setDismissed] = useState(() => new Set())
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const lastLoadAt = useRef(0)

  const load = useCallback(async () => {
    if (!profile?.id) return
    lastLoadAt.current = Date.now()
    const { data } = await supabase
      .from('schedule_change_requests')
      .select('*')
      .eq('approver_id', profile.id)
      .eq('status', 'pending')
      .order('created_at')
    setItems(data ?? [])
  }, [profile?.id])

  useEffect(() => {
    load()
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastLoadAt.current > RECHECK_GAP_MS) load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const open = items.some((i) => !dismissed.has(i.id))
  if (!open) return null

  async function decide(item, approve) {
    setBusyId(item.id)
    setError('')
    const { error: err } = await supabase.rpc('decide_schedule_change', { p_id: item.id, p_approve: approve })
    setBusyId(null)
    if (err) {
      setError(err.message)
      // Someone else (or the requester) already dealt with it — drop it from the list.
      if (/already been/i.test(err.message)) setItems((prev) => prev.filter((i) => i.id !== item.id))
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id))
  }

  return (
    <Modal
      open
      onClose={() => setDismissed(new Set(items.map((i) => i.id)))}
      title="Changes waiting for your approval"
      footer={
        <Button variant="secondary" onClick={() => setDismissed(new Set(items.map((i) => i.id)))}>
          Decide later
        </Button>
      }
    >
      <p className="mb-3 text-sm text-gray-600">
        These changes only take effect once you approve them. Staff see "Waiting for manager approval" until then.
      </p>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-brand-100 bg-brand-50/40 p-3">
            <div className="text-sm font-semibold text-gray-800">{item.requester_name || 'A staff member'}</div>
            <div className="text-xs text-gray-500">
              {item.title}
              {item.reason_code === 'roster_submitted' ? ' · roster already submitted' : ' · past the cut-off'}
            </div>
            <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
              {(item.details ?? []).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => decide(item, true)} disabled={busyId === item.id}>
                Approve
              </Button>
              <Button variant="danger" onClick={() => decide(item, false)} disabled={busyId === item.id}>
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </Modal>
  )
}
