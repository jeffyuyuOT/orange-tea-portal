import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { rosterDisplayName } from '../../lib/excelRoster'
import Button from '../../components/ui/Button'
import SimpleRichTextEditor from '../../components/ui/SimpleRichTextEditor'

// Jeff, 2026-09: "新增Support分頁，下面可以填寫標題，內容(可附加單個或多個
// 圖片)提交，提交後會給予case number...並移到該員的message sent分夜裡...
// 提交的message則會進到developer(目前是jeff chuang)的inbox裡" — a plain
// submit form. Images ride the same inline rich-text image upload every
// other content field in this app already uses (SimpleRichTextEditor),
// rather than a separate attachment picker — no need for a second upload
// mechanism just for this. Submitting doesn't create anything new to look
// at here: it opens a support_requests row (migration
// 0069_support_requests.sql) for the case number, then sends an ordinary
// private message — this person to sender, every active `developer`-role
// account as recipients — so the case shows up in their own Message > Sent
// tab and the developer's Message > Inbox tab for free (see
// MessagePage.jsx / MessageDetailModal.jsx for the Case #/Incomplete/
// Complete badge and the developer-only "Mark as complete" toggle).
//
// Jeff, 2026-09: this is its OWN top-level Sidebar section ("跟my dashboard
// 同等級，不是在my dashboard下") — see permissions.js's top-level `support`
// SECTIONS entry and routes.jsx's /support/submit-request route. Briefly
// lived nested under My Dashboard; moved out per Jeff's correction. It still
// hands off delivery to the private Message system that lives under
// `dashboard` — that's a data/delivery detail, not a nav one.
export default function SupportPage() {
  const { profile, currentStoreId } = useAuth()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submittedCase, setSubmittedCase] = useState(null)

  async function submit() {
    if (!title.trim() || !currentStoreId) return
    setSubmitting(true)
    setError('')
    try {
      // This store's own display name for the submitter (Roster Hub >
      // Setting > Name Display) — same "follows display name" rule Message
      // uses elsewhere, stamped as a permanent snapshot the same way
      // sender_name is on messages.
      const { data: storeRow } = await supabase
        .from('user_stores')
        .select('roster_display_name')
        .eq('store_id', currentStoreId)
        .eq('profile_id', profile.id)
        .maybeSingle()
      const submittedByName = rosterDisplayName({ ...profile, roster_display_name: storeRow?.roster_display_name }) || profile.email

      const { data: request, error: requestError } = await supabase
        .from('support_requests')
        .insert({
          submitted_by: profile.id,
          submitted_by_name: submittedByName,
          store_id: currentStoreId,
          title: title.trim(),
          content_html: content,
        })
        .select()
        .single()
      if (requestError) throw requestError

      const { data: developers, error: devError } = await supabase.from('profiles').select('id').eq('role', 'developer').eq('is_active', true)
      if (devError) throw devError
      if (!developers?.length) throw new Error('No active developer account to receive this — contact Jeff directly.')

      const { data: msg, error: msgError } = await supabase
        .from('messages')
        .insert({
          store_id: currentStoreId,
          sender_id: profile.id,
          sender_name: submittedByName,
          subject: `${title.trim()} (Case #${request.case_number})`,
          content_html: content,
          support_request_id: request.id,
        })
        .select()
        .single()
      if (msgError) throw msgError

      const { error: recError } = await supabase
        .from('message_recipients')
        .insert(developers.map((d) => ({ message_id: msg.id, profile_id: d.id })))
      if (recError) throw recError

      setSubmittedCase(request.case_number)
      setTitle('')
      setContent('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Support</h1>
      <p className="mb-4 text-sm text-gray-500">
        Submit a request — it's sent as a private message to the developer and also lands in your own Message &gt;
        Sent tab, with a case number to track it.
      </p>

      {submittedCase != null && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Submitted — Case #{submittedCase}.{' '}
          <Link to="/dashboard/message" className="font-medium underline">
            View in Message &gt; Sent
          </Link>
        </div>
      )}
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Error: {error}</div>}

      <div className="max-w-2xl space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        />
        <SimpleRichTextEditor
          value={content}
          onChange={setContent}
          placeholder="Describe the issue or request… (you can add photos)"
          imageUploadPath={`support/${currentStoreId}`}
        />
        <Button onClick={submit} disabled={submitting || !title.trim()}>
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
    </div>
  )
}
