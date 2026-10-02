import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import { NON_PICKABLE_STAFF_ROLES } from '../../../lib/permissions'
import { rosterDisplayName } from '../../../lib/excelRoster'

// Jeff, 2026-09: "message的user名稱會依照display name顯示" — same per-store
// Name Display setting (Roster Hub > Setting) everything else on the
// roster already respects, not the account's raw first/last name. `p` here
// is either a `user_stores`-embedded profile with `roster_display_name`
// already folded on (see below), or a plain profile with none — falls back
// to the same first-name-only default rosterDisplayName() uses everywhere
// else, and to email as a last resort for someone with no name at all.
function nameOf(p) {
  return rosterDisplayName(p) || p.email
}

// Shared compose UI for a brand-new Message AND for Reply/Reply All/Forward
// (MessageDetailModal just pre-fills `initial` for those three — this modal
// doesn't need to know which one it was, it's always "send a new message
// row, optionally linked back via in_reply_to"). Jeff, 2026-09: originally
// lived under Bulletin Board's "Message" tab, then moved into its own "My
// Dashboard" page (MessagePage.jsx) — private, recipients picked from
// same-store users only, excluding training/qr_code_maker/accountant
// (confirmed with Jeff: admin stays pickable — his first draft of the spec
// also excluded admin, corrected afterwards to "exclude training,
// accountant and 2d maker only"). migration 0066_bulletin_messages.sql.
// `storeId` decides who's eligible to pick as a recipient (same-store
// membership) and is stamped onto the message row itself (bookkeeping/RLS
// write-scope only — reading a message back is entirely per-recipient via
// message_recipients, not store-scoped; see MessagePage.jsx, which lists
// Inbox/Sent across every store). It's also what picks whose
// roster_display_name applies — see nameOf() above. It is NOT always the
// sender's current StoreSwitcher store: MessagePage.jsx's "+ New message"
// passes currentStoreId (a brand-new conversation, started wherever the
// sender's currently working), but MessageDetailModal.jsx's Reply/Reply
// All/Forward pass the ORIGINAL message's own store_id instead — Jeff,
// 2026-09: a multi-store admin/developer replying to a message from a
// different store than the one they currently have selected must not have
// their reply filed under whatever store they happened to be on; see the
// longer comment on MessageDetailModal.jsx.
// Jeff, 2026-10-03: "developer新增message時，寄件者選擇裡最上面有一個all選
// 項，選擇all的話則會寄給所有分店所有user，但對方看到的寄件者會變成系統，用
// 來發布系統訊息用" — a developer-only "All" option at the top of the To
// list, for brand-new messages only (not Reply/Reply All/Forward — see
// `canBroadcast` below). Checking it ignores the normal same-store
// recipient picker entirely and sends to every active user at every store;
// the message's sender_name is stamped as "System" instead of this
// developer's own display name, so it reads to every recipient as an
// official system announcement, not a personal message from that account.
export default function ComposeMessageModal({ storeId, senderProfile, initial, onClose, onSent }) {
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [recipientIds, setRecipientIds] = useState(initial?.recipientIds ?? [])
  const [candidates, setCandidates] = useState([])
  // This store's own display name for the sender — stamped onto the
  // message as sender_name (a permanent snapshot, same pattern as
  // created_by_name elsewhere). Falls back to plain rosterDisplayName on
  // the bare senderProfile (no roster_display_name available) if for any
  // reason this store's user_stores row isn't found below.
  const [senderDisplayName, setSenderDisplayName] = useState(nameOf(senderProfile))
  const [sending, setSending] = useState(false)
  const [sendToAll, setSendToAll] = useState(false)
  const canBroadcast = senderProfile.role === 'developer' && !initial?.inReplyTo

  useEffect(() => {
    if (!storeId) return
    supabase
      .from('user_stores')
      .select('profile_id, roster_display_name, profiles(id, first_name, last_name, email, role, is_active)')
      .eq('store_id', storeId)
      .then(({ data }) => {
        const byId = new Map()
        ;(data ?? []).forEach((r) => {
          const p = r.profiles
          if (!p) return
          if (p.id === senderProfile.id) {
            setSenderDisplayName(nameOf({ ...p, roster_display_name: r.roster_display_name }))
            return
          }
          if (p.is_active && !NON_PICKABLE_STAFF_ROLES.includes(p.role)) {
            byId.set(p.id, { ...p, roster_display_name: r.roster_display_name })
          }
        })
        setCandidates(Array.from(byId.values()).sort((a, b) => nameOf(a).localeCompare(nameOf(b))))
      })
  }, [storeId, senderProfile.id])

  function toggleRecipient(id) {
    setRecipientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function send() {
    if (!subject.trim() || (!sendToAll && !recipientIds.length)) return
    setSending(true)

    // Broadcast mode ignores the same-store candidate picker entirely — the
    // recipient set is every active user, every store, resolved fresh at
    // send time rather than from whatever happened to be in `candidates`.
    let finalRecipientIds = recipientIds
    if (sendToAll) {
      const { data: allProfiles } = await supabase.from('profiles').select('id').eq('is_active', true).neq('id', senderProfile.id)
      finalRecipientIds = (allProfiles ?? []).map((p) => p.id)
    }

    const { data: msg, error } = await supabase
      .from('messages')
      .insert({
        store_id: storeId,
        sender_id: senderProfile.id,
        sender_name: sendToAll ? 'System' : senderDisplayName,
        subject: subject.trim(),
        content_html: content,
        in_reply_to: initial?.inReplyTo ?? null,
      })
      .select()
      .single()
    if (error) {
      alert(`Send failed: ${error.message}`)
      setSending(false)
      return
    }
    const { error: recError } = await supabase
      .from('message_recipients')
      .insert(finalRecipientIds.map((id) => ({ message_id: msg.id, profile_id: id })))
    setSending(false)
    if (recError) {
      alert(`Send failed: ${recError.message}`)
      return
    }
    onSent()
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="New Message"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending || !subject.trim() || (!sendToAll && !recipientIds.length)}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
          {canBroadcast && (
            <label className="mb-1.5 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-medium text-brand-700">
              <input type="checkbox" checked={sendToAll} onChange={(e) => setSendToAll(e.target.checked)} />
              📢 All — every store, every user (sent as "System")
            </label>
          )}
          <div className={`max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 ${sendToAll ? 'opacity-40' : ''}`}>
            {candidates.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={recipientIds.includes(c.id)}
                  disabled={sendToAll}
                  onChange={() => toggleRecipient(c.id)}
                />
                {nameOf(c)}
              </label>
            ))}
            {!candidates.length && <p className="text-xs text-gray-400">No one else eligible to message at this store.</p>}
          </div>
        </div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        />
        <SimpleRichTextEditor value={content} onChange={setContent} placeholder="Message…" imageUploadPath={`messages/${storeId}`} />
      </div>
    </Modal>
  )
}
