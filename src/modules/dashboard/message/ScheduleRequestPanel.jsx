import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'

// Jeff, 2026-11-28: the "Approval needed" Message sent to the approver (see createChangeRequest in
// lib/scheduleLock.js) shows the change request itself here, with Approve / Reject — so approving
// doesn't depend on the login pop-up. Shows nothing for any other message, or for anyone who isn't
// the request's approver / requester.
export default function ScheduleRequestPanel({ messageId, profile, onDecided }) {
  const [req, setReq] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { data } = await supabase.from('schedule_change_requests').select('*').eq('message_id', messageId).maybeSingle()
    setReq(data ?? null)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId])

  if (!req) return null
  const canDecide = req.status === 'pending' && req.approver_id === profile?.id

  async function decide(approve) {
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('decide_schedule_change', { p_id: req.id, p_approve: approve })
    setBusy(false)
    if (err) {
      setError(err.message)
      load()
      return
    }
    await load()
    onDecided?.()
  }

  const statusColor = { pending: 'brand', approved: 'green', rejected: 'red', cancelled: 'gray' }[req.status] ?? 'gray'
  const statusLabel =
    { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Withdrawn by the requester' }[req.status] ?? req.status

  return (
    <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-800">{req.requester_name || 'A staff member'}</span>
        <span className="text-xs text-gray-500">
          {req.title}
          {req.reason_code === 'roster_submitted' ? ' · roster already submitted' : ' · past the cut-off'}
        </span>
        <Badge color={statusColor}>{statusLabel}</Badge>
      </div>
      <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
        {(req.details ?? []).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {canDecide && (
        <div className="mt-3 flex gap-2">
          <Button onClick={() => decide(true)} disabled={busy}>
            Approve
          </Button>
          <Button variant="danger" onClick={() => decide(false)} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
