import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import RichTextViewer from '../../../components/ui/RichTextViewer'

// The category dropdown is really just a friendlier front end over two
// independent fields: `category` (Normal vs Customer Complaint — a real
// distinct type, since Customer Complaint gets its own Bulletin tab and a
// Solved tracker) and `is_important` (a plain boolean that a normal
// announcement can still be flipped on/off at any time later, on its own,
// regardless of category). Picking "Important" here is just a shortcut
// that pre-checks "Mark as important" for you; the checkbox below stays
// the actual source of truth, so the dropdown's shown value is always
// derived FROM category+isImportant, never stored on its own.
const CATEGORY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'important', label: 'Important' },
  { value: 'customer_complaint', label: 'Customer Complaint' },
]

function nameOf(profile) {
  return `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email
}

export default function AnnouncementDetailModal({ announcementId, storeId, onClose, onSaved }) {
  const { profile } = useAuth()
  const isNew = !announcementId
  const canEdit = profile?.role === 'admin' || profile?.role === 'shop_manager'
  const [editing, setEditing] = useState(isNew)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isImportant, setIsImportant] = useState(false)
  const [category, setCategory] = useState('normal')
  const [createdBy, setCreatedBy] = useState(null)
  const [solved, setSolved] = useState(false)
  // The checkbox itself only edits this draft — nothing is written until
  // Submit is clicked, so ticking it by accident (or while still reading
  // the complaint) can't silently mark it solved. Reset back to whatever
  // was actually loaded/saved whenever that changes underneath it.
  const [draftSolved, setDraftSolved] = useState(false)
  const [solvedByName, setSolvedByName] = useState(null)
  const [solvedAt, setSolvedAt] = useState(null)
  const [solving, setSolving] = useState(false)
  const [history, setHistory] = useState([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isComplaint = category === 'customer_complaint'
  const isCreator = !!profile && profile.id === createdBy
  // Everyone who can post can delete (per the "manager admin write
  // announcements" RLS policy — any manager/admin with access to this
  // store, not just the original poster), so the button is really always
  // available to canEdit; only the label changes to reflect that the
  // creator is "retracting" their own post rather than moderating
  // someone else's.
  const deleteLabel = isCreator ? 'Retract' : 'Delete'
  const categorySelectValue = isComplaint ? 'customer_complaint' : isImportant ? 'important' : 'normal'

  useEffect(() => {
    if (isNew) return
    supabase
      .from('announcements')
      .select('*')
      .eq('id', announcementId)
      .single()
      .then(({ data }) => {
        if (data) {
          setTitle(data.title)
          setContent(data.content_html ?? '')
          setIsImportant(data.is_important)
          setCategory(data.category ?? 'normal')
          setCreatedBy(data.created_by)
          setSolved(data.solved ?? false)
          setDraftSolved(data.solved ?? false)
          setSolvedByName(data.solved_by_name ?? null)
          setSolvedAt(data.solved_at ?? null)
        }
      })
    supabase
      .from('announcement_history')
      .select('*, actor:actor_id(first_name,last_name)')
      .eq('announcement_id', announcementId)
      .order('acted_at', { ascending: false })
      .then(({ data }) => setHistory(data ?? []))
  }, [announcementId, isNew])

  function onCategorySelect(value) {
    if (value === 'customer_complaint') {
      setCategory('customer_complaint')
    } else {
      setCategory('normal')
      setIsImportant(value === 'important')
    }
  }

  async function save() {
    setSaving(true)
    try {
      // created_by_name/actor_name are permanent text snapshots (not a
      // live join) — so "who posted this" still shows correctly even
      // after that person's account is later removed.
      const actorName = nameOf(profile)
      if (isNew) {
        const { data, error } = await supabase
          .from('announcements')
          .insert({
            store_id: storeId,
            title,
            content_html: content,
            is_important: isImportant,
            category,
            created_by: profile.id,
            created_by_name: actorName,
            updated_by: profile.id,
            updated_by_name: actorName,
          })
          .select()
          .single()
        if (error) throw error
        await supabase
          .from('announcement_history')
          .insert({ announcement_id: data.id, action: 'created', actor_id: profile.id, actor_name: actorName })
        // The poster has obviously already "seen" their own post — mark it
        // read for them so it doesn't show up flagged NEW on their own
        // Bulletin Board.
        await supabase.from('announcement_reads').upsert(
          { profile_id: profile.id, announcement_id: data.id },
          { onConflict: 'profile_id,announcement_id', ignoreDuplicates: true }
        )
      } else {
        const { error } = await supabase
          .from('announcements')
          .update({ title, content_html: content, is_important: isImportant, category, updated_by: profile.id, updated_by_name: actorName })
          .eq('id', announcementId)
        if (error) throw error
        await supabase
          .from('announcement_history')
          .insert({ announcement_id: announcementId, action: 'edited', actor_id: profile.id, actor_name: actorName })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  // Writes the staged Solved/Unsolved change — independent of the Edit/Save
  // flow, so solved_at reflects the moment Submit was actually clicked, not
  // whenever some unrelated edit happens to be saved.
  async function submitSolved() {
    setSolving(true)
    const actorName = nameOf(profile)
    const payload = draftSolved
      ? { solved: true, solved_by: profile.id, solved_by_name: actorName, solved_at: new Date().toISOString() }
      : { solved: false, solved_by: null, solved_by_name: null, solved_at: null }
    const { error } = await supabase.from('announcements').update(payload).eq('id', announcementId)
    if (!error) {
      await supabase
        .from('announcement_history')
        .insert({ announcement_id: announcementId, action: draftSolved ? 'solved' : 'reopened', actor_id: profile.id, actor_name: actorName })
    }
    setSolving(false)
    if (error) {
      alert(`Update failed: ${error.message}`)
      return
    }
    setSolved(payload.solved)
    setDraftSolved(payload.solved)
    setSolvedByName(payload.solved_by_name)
    setSolvedAt(payload.solved_at)
    // Without this, the write above succeeds but the list this modal was
    // opened from (BulletinPage / AnnouncementsTab) never re-fetches, so it
    // keeps showing whatever Solved/Unsolved badge it had when the modal
    // was first opened — that's why toggling to Unsolved and hitting Submit
    // looked like it "still showed Solved" afterwards. Every other write in
    // this modal (save(), removeAnnouncement()) already closes + refreshes
    // the list this same way.
    onSaved()
  }

  async function removeAnnouncement() {
    setDeleting(true)
    const { error } = await supabase.from('announcements').delete().eq('id', announcementId)
    setDeleting(false)
    if (error) {
      alert(`${deleteLabel} failed: ${error.message}`)
      return
    }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? 'New Announcement' : editing ? 'Edit Announcement' : title}
      footer={
        canEdit &&
        (editing ? (
          <>
            <Button variant="secondary" onClick={() => (isNew ? onClose() : setEditing(false))}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !title}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {deleteLabel}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        ))
      }
    >
      {editing ? (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Category</span>
            <select
              className="input max-w-xs"
              value={categorySelectValue}
              onChange={(e) => onCategorySelect(e.target.value)}
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <SimpleRichTextEditor
            value={content}
            onChange={setContent}
            placeholder="Announcement content…"
            imageUploadPath={`announcements/${storeId}`}
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} />
            Mark as important
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {isComplaint && <Badge color="red">Customer Complaint</Badge>}
            {isImportant && <Badge color="red">Important</Badge>}
            {isComplaint && (solved ? <Badge color="green">Solved</Badge> : <Badge color="gray">Unsolved</Badge>)}
          </div>

          {isComplaint && (
            <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={draftSolved}
                    disabled={solving}
                    onChange={(e) => setDraftSolved(e.target.checked)}
                  />
                  Solved
                </label>
                {draftSolved !== solved && (
                  <Button onClick={submitSolved} disabled={solving} className="!px-3 !py-1 !text-xs">
                    {solving ? 'Submitting…' : 'Submit'}
                  </Button>
                )}
              </div>
              {solved && solvedAt && (
                <p className="mt-1 text-xs text-gray-500">
                  Marked solved {new Date(solvedAt).toLocaleString()}
                  {solvedByName ? ` by ${solvedByName}` : ''}
                </p>
              )}
            </div>
          )}

          <RichTextViewer html={content} />
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-400">History</h4>
            <ul className="space-y-1 text-xs text-gray-500">
              {history.map((h) => (
                <li key={h.id}>
                  {new Date(h.acted_at).toLocaleString()} — {h.action.replace('_', ' ')} by{' '}
                  {h.actor_name || (h.actor ? `${h.actor.first_name ?? ''} ${h.actor.last_name ?? ''}`.trim() : 'Unknown')}
                </li>
              ))}
            </ul>
          </div>

          {confirmDelete && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {isCreator
                ? 'Retract this announcement? This permanently removes it and its history.'
                : 'Delete this announcement? This permanently removes it and its history.'}
              <div className="mt-2 flex gap-2">
                <Button variant="danger" onClick={removeAnnouncement} disabled={deleting}>
                  {deleting ? 'Removing…' : `Confirm ${deleteLabel.toLowerCase()}`}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
