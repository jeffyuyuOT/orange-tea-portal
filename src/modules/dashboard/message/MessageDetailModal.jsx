import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import RichTextViewer from '../../../components/ui/RichTextViewer'
import ComposeMessageModal from './ComposeMessageModal'
import { rosterDisplayName } from '../../../lib/excelRoster'

// Jeff, 2026-09: same per-store Name Display setting as everywhere else on
// the roster, not the raw account name — see nameByProfile below, which
// resolves it for THIS message's own store_id (recipients are always
// same-store as the sender, so one lookup covers everyone on this list).
function nameOf(p, nameByProfile) {
  if (!p) return 'Unknown'
  const withDisplayName = { ...p, roster_display_name: nameByProfile?.get(p.id) }
  return rosterDisplayName(withDisplayName) || p.email || 'Unknown'
}

// Jeff, 2026-09: opening a received Message can Reply / Reply All / Forward
// — each just opens ComposeMessageModal pre-filled and linked back via
// in_reply_to. No nested thread view — just a flat "new message that
// happens to reference an earlier one", same as Jeff's spec (reply/reply
// all/forward each just send a new message). `storeId` is only used to hand
// off to ComposeMessageModal (which recipient are eligible), never to
// restrict which messages can be opened here — see MessagePage.jsx.
export default function MessageDetailModal({ messageId, storeId, profile, onClose, onChanged }) {
  const [message, setMessage] = useState(null)
  const [recipients, setRecipients] = useState([])
  const [nameByProfile, setNameByProfile] = useState(new Map())
  const [composeInitial, setComposeInitial] = useState(null)
  // Jeff, 2026-09: a Support request message carries a linked
  // support_requests row (support_request_id, migration
  // 0069_support_requests.sql) — the developer(s) it was sent to can tick
  // "Mark as complete" here; the submitter sees the same Complete/
  // Incomplete status but can't toggle it (see canToggleComplete below).
  // The checkbox only edits this draft until Submit is clicked, same
  // pattern as Customer Complaint's Solved toggle in
  // AnnouncementDetailModal.jsx.
  const [draftCompleted, setDraftCompleted] = useState(false)
  const [updatingComplete, setUpdatingComplete] = useState(false)

  useEffect(() => {
    supabase
      .from('messages')
      .select('*, support_request:support_requests(id, case_number, completed)')
      .eq('id', messageId)
      .single()
      .then(({ data }) => {
        setMessage(data)
        setDraftCompleted(data?.support_request?.completed ?? false)
      })
    supabase
      .from('message_recipients')
      .select('profile_id, read_at, profiles(id, first_name, last_name, email)')
      .eq('message_id', messageId)
      .then(({ data }) => setRecipients(data ?? []))
  }, [messageId])

  // Per-store display names (Roster Hub > Setting > Name Display) for
  // everyone on this message — sender + every recipient are always at the
  // same store (see ComposeMessageModal), so one user_stores lookup for
  // message.store_id covers the whole "To:"/"From:" list.
  useEffect(() => {
    if (!message?.store_id) return
    supabase
      .from('user_stores')
      .select('profile_id, roster_display_name')
      .eq('store_id', message.store_id)
      .then(({ data }) => setNameByProfile(new Map((data ?? []).map((r) => [r.profile_id, r.roster_display_name]))))
  }, [message?.store_id])

  // Opening this is "having read it" — mark my own copy read, if I'm a
  // recipient and it isn't already (same New/read-marker pattern as
  // announcement_reads elsewhere in Bulletin). A no-op (0 rows touched) if
  // I'm the sender rather than a recipient, or already read it.
  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('message_recipients')
      .update({ read_at: new Date().toISOString() })
      .eq('message_id', messageId)
      .eq('profile_id', profile.id)
      .is('read_at', null)
      .then(({ error }) => {
        if (!error) onChanged?.()
      })
  }, [messageId, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!message) return null

  const isMine = message.sender_id === profile.id
  const others = recipients.filter((r) => r.profile_id !== profile.id)
  const supportRequest = message.support_request
  // Only a recipient (i.e. one of the developer accounts this Support
  // request went to) can toggle completion — the submitter sees the same
  // status but this is deliberately read-only for them, per Jeff:
  // "訊息裡developer可以勾選已完成"（開case的人自己不行標記完成）.
  const canToggleComplete = !!supportRequest && !isMine

  function openReply() {
    setComposeInitial({
      subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
      recipientIds: [message.sender_id].filter(Boolean),
      content: '',
      inReplyTo: message.id,
    })
  }
  function openReplyAll() {
    const ids = new Set([message.sender_id, ...recipients.map((r) => r.profile_id)])
    ids.delete(profile.id)
    setComposeInitial({
      subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
      recipientIds: Array.from(ids).filter(Boolean),
      content: '',
      inReplyTo: message.id,
    })
  }
  function openForward() {
    setComposeInitial({
      subject: message.subject.startsWith('Fwd:') ? message.subject : `Fwd: ${message.subject}`,
      recipientIds: [],
      content: `<p>---- Forwarded message from ${message.sender_name} ----</p>${message.content_html ?? ''}`,
      inReplyTo: message.id,
    })
  }

  // Writes the staged Complete/Incomplete change — same "stage then
  // Submit" shape as AnnouncementDetailModal's submitSolved(), so ticking
  // the box while reading can't silently write anything until confirmed.
  async function submitCompleted() {
    setUpdatingComplete(true)
    const { error } = await supabase
      .from('support_requests')
      .update({
        completed: draftCompleted,
        completed_at: draftCompleted ? new Date().toISOString() : null,
        completed_by: draftCompleted ? profile.id : null,
      })
      .eq('id', supportRequest.id)
    setUpdatingComplete(false)
    if (error) {
      alert(`Update failed: ${error.message}`)
      return
    }
    setMessage((prev) => ({ ...prev, support_request: { ...prev.support_request, completed: draftCompleted } }))
    onChanged?.()
  }

  return (
    <>
      <Modal
        open={!composeInitial}
        onClose={onClose}
        wide
        title={message.subject}
        footer={
          <>
            {!isMine && (
              <Button variant="secondary" onClick={openReply}>
                Reply
              </Button>
            )}
            {!isMine && others.length > 0 && (
              <Button variant="secondary" onClick={openReplyAll}>
                Reply All
              </Button>
            )}
            <Button variant="secondary" onClick={openForward}>
              Forward
            </Button>
          </>
        }
      >
        <div className="mb-3 text-xs text-gray-500">
          <p>From: {message.sender_name}</p>
          <p>To: {recipients.map((r) => nameOf(r.profiles, nameByProfile)).join(', ') || '—'}</p>
          <p>{new Date(message.created_at).toLocaleString()}</p>
        </div>

        {supportRequest && (
          <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Case #{supportRequest.case_number}</span>
              {canToggleComplete ? (
                <>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={draftCompleted}
                      disabled={updatingComplete}
                      onChange={(e) => setDraftCompleted(e.target.checked)}
                    />
                    Mark as complete
                  </label>
                  {draftCompleted !== supportRequest.completed && (
                    <Button onClick={submitCompleted} disabled={updatingComplete} className="!px-3 !py-1 !text-xs">
                      {updatingComplete ? 'Submitting…' : 'Submit'}
                    </Button>
                  )}
                </>
              ) : (
                <Badge color={supportRequest.completed ? 'green' : 'red'}>
                  {supportRequest.completed ? 'Complete' : 'Incomplete'}
                </Badge>
              )}
            </div>
          </div>
        )}

        <RichTextViewer html={message.content_html} />
      </Modal>
      {composeInitial && (
        <ComposeMessageModal
          storeId={storeId}
          senderProfile={profile}
          initial={composeInitial}
          onClose={() => setComposeInitial(null)}
          onSent={() => {
            setComposeInitial(null)
            onChanged?.()
            onClose()
          }}
        />
      )}
    </>
  )
}
