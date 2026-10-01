import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import RichTextViewer from '../../../components/ui/RichTextViewer'
import AnnouncementViewersModal from './AnnouncementViewersModal'
import { deleteStorageImages } from '../../../lib/richTextImages'

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
  const { profile, accessibleStores } = useAuth()
  const isNew = !announcementId
  // developer counts as manager/admin here too — see BulletinPage.jsx's
  // matching comment (Jeff, 2026-09: developer couldn't edit/delete their
  // own post's manager-only bits, or see "View history", for the same
  // reason posting was broken for them).
  const isManagerOrAdmin = profile?.role === 'admin' || profile?.role === 'shop_manager' || profile?.role === 'developer'
  // Jeff, 2026-09: admin/developer can broadcast a brand-new announcement to
  // several stores at once ("有的訊息是要給所有分店或特定那些分店的") — admin/
  // developer are the only roles whose accessibleStores ever spans more than
  // one store in the first place (see AuthContext.jsx), and RLS already lets
  // both write announcements at any store_id via is_admin() (migration 0058
  // makes developer that function's superset too), so this needs no DB
  // change — just picking which store(s) each checked box turns into its own
  // independent row for below.
  const canBroadcast = isNew && (profile?.role === 'admin' || profile?.role === 'developer') && accessibleStores.length > 1
  const [editing, setEditing] = useState(isNew)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isImportant, setIsImportant] = useState(false)
  const [category, setCategory] = useState('normal')
  // Defaults to just the store this modal was opened from — ticking more
  // boxes is opt-in, so behaviour for anyone who never touches this section
  // (shop_manager, or a single-store admin/developer) is unchanged.
  const [selectedStoreIds, setSelectedStoreIds] = useState(() => [storeId])
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
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [showViewers, setShowViewers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isComplaint = category === 'customer_complaint'
  const isCreator = !!profile && profile.id === createdBy
  // Who can edit the title/content or delete/retract this post: the
  // original creator (of a staff-posted item — see migration 0056),
  // manager/admin at this store (who can still touch anyone's post), or
  // anyone at all while creating a brand-new one. Everyone else (a staff
  // member viewing someone ELSE's post) still gets the Comments section
  // below, and the Solved checkbox on a complaint, just not this footer.
  const canManageThis = isNew || isManagerOrAdmin || isCreator
  // Everyone who can manage a post can delete it (per the "manager admin
  // write announcements" RLS policy for manager/admin — any manager/admin
  // with access to this store, not just the original poster — and per the
  // "staff delete own announcements" policy for a staff creator, which is
  // their own post only), so the button is really always available to
  // canManageThis; only the label changes to reflect that the creator is
  // "retracting" their own post rather than moderating someone else's.
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
    // "Supplement" comments (migration 0056) — anyone who can see this
    // post can add one, regardless of who posted it, separate from the
    // History log above and from editing the post's own title/content.
    supabase
      .from('announcement_comments')
      .select('*, author:author_id(first_name,last_name)')
      .eq('announcement_id', announcementId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setComments(data ?? []))
    // Opening an EXISTING item is "having looked at it" — marks/refreshes
    // this person's own read receipt (migration 0056), which is what clears
    // its New/Update badge on the Bulletin Board list (BulletinPage.jsx
    // reloads on close to pick this up) and what populates the manager/
    // admin-only "View history" list (AnnouncementViewersModal). Written
    // here rather than by whichever list opened this modal, so it's covered
    // no matter the entry point (the main feed, or the separate "⭐
    // Important Announcements" picker).
    if (profile?.id) {
      supabase
        .from('announcement_reads')
        .upsert({ profile_id: profile.id, announcement_id: announcementId, read_at: new Date().toISOString() }, { onConflict: 'profile_id,announcement_id' })
    }
  }, [announcementId, isNew]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleStore(id) {
    setSelectedStoreIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

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
        // A broadcast to N stores becomes N independent rows — same reasoning
        // as the comment on canBroadcast above: each store's copy gets its
        // own id, history, comments and read receipts, exactly like every
        // other per-store admin/developer content in this app, rather than
        // one row several stores would have to jointly own.
        const targetStoreIds = canBroadcast && selectedStoreIds.length ? selectedStoreIds : [storeId]
        for (const targetStoreId of targetStoreIds) {
          const { data, error } = await supabase
            .from('announcements')
            .insert({
              store_id: targetStoreId,
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
        }
      } else {
        const { error } = await supabase
          .from('announcements')
          .update({ title, content_html: content, is_important: isImportant, category, updated_by: profile.id, updated_by_name: actorName })
          .eq('id', announcementId)
        if (error) throw error
        await supabase
          .from('announcement_history')
          .insert({ announcement_id: announcementId, action: 'edited', actor_id: profile.id, actor_name: actorName })
        // Same as the isNew branch above — the editor has obviously just
        // seen their own edit, so mark it read for them too (this time as
        // a real upsert, since a read row from before the edit may already
        // exist and needs its read_at bumped past the new updated_at, or
        // this same edit would otherwise show up flagged Update on the
        // editor's own Bulletin Board).
        await supabase
          .from('announcement_reads')
          .upsert({ profile_id: profile.id, announcement_id: announcementId, read_at: new Date().toISOString() }, { onConflict: 'profile_id,announcement_id' })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  // Posts a "supplement" comment (migration 0056) — open to anyone who can
  // see this post, regardless of who created it, separate from Edit/Save
  // above (which stays restricted to the creator + manager/admin).
  async function postComment() {
    const body = newComment.trim()
    if (!body) return
    setPostingComment(true)
    const actorName = nameOf(profile)
    const { data, error } = await supabase
      .from('announcement_comments')
      .insert({ announcement_id: announcementId, author_id: profile.id, author_name: actorName, content: body })
      .select('*, author:author_id(first_name,last_name)')
      .single()
    setPostingComment(false)
    if (error) {
      alert(`Could not post comment: ${error.message}`)
      return
    }
    setComments((prev) => [...prev, data])
    setNewComment('')
  }

  // Writes the staged Solved/Unsolved change — independent of the Edit/Save
  // flow, so solved_at reflects the moment Submit was actually clicked, not
  // whenever some unrelated edit happens to be saved. Routed through the
  // set_complaint_solved() function (migration 0056) rather than a direct
  // update, so anyone who can see this complaint — staff included, not
  // just the creator or manager/admin — can toggle Solved without also
  // getting broad UPDATE rights over the complaint's title/content.
  async function submitSolved() {
    setSolving(true)
    const { error } = await supabase.rpc('set_complaint_solved', {
      p_announcement_id: announcementId,
      p_solved: draftSolved,
    })
    setSolving(false)
    if (error) {
      alert(`Update failed: ${error.message}`)
      return
    }
    const actorName = nameOf(profile)
    setSolved(draftSolved)
    setSolvedByName(draftSolved ? actorName : null)
    setSolvedAt(draftSolved ? new Date().toISOString() : null)
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
    // Jeff, 2026-10-02: "公告刪除時一併刪除對應的 storage 檔案" — the post row
    // is already gone at this point; `content` (this modal's loaded
    // content_html) is the only place that knows which storage image(s), if
    // any, belonged to it. Best-effort — see deleteStorageImages' comment —
    // so a cleanup failure here never makes a successful delete look like
    // it failed.
    deleteStorageImages(content, 'documents')
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? 'New Announcement' : editing ? 'Edit Announcement' : title}
      footer={
        canManageThis &&
        (editing ? (
          <>
            <Button variant="secondary" onClick={() => (isNew ? onClose() : setEditing(false))}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !title || (canBroadcast && !selectedStoreIds.length)}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {deleteLabel}
            </Button>
            {/* Manager/admin-only read-receipt list — who has actually
                opened this post (see migration 0056 / AnnouncementViewersModal). */}
            {isManagerOrAdmin && (
              <Button variant="secondary" onClick={() => setShowViewers(true)}>
                View history
              </Button>
            )}
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
          {canBroadcast && (
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Publish to stores (checked stores each get this announcement)
              </span>
              <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 p-2">
                {accessibleStores.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                    <input type="checkbox" checked={selectedStoreIds.includes(s.id)} onChange={() => toggleStore(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}
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

          {/* "Supplement" comments (migration 0056) — anyone who can see
              this post can add one here, regardless of who created it;
              this is separate from Edit/Save above, which stays limited to
              the creator + manager/admin. */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-400">Comments</h4>
            <ul className="mb-2 space-y-1.5">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <p className="whitespace-pre-wrap text-gray-700">{c.content}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {c.author_name || (c.author ? `${c.author.first_name ?? ''} ${c.author.last_name ?? ''}`.trim() : 'Unknown')} ·{' '}
                    {new Date(c.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
              {!comments.length && <li className="text-xs text-gray-400">No comments yet.</li>}
            </ul>
            <div className="flex gap-2">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && postComment()}
                placeholder="Add a comment…"
                disabled={postingComment}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
              />
              <Button onClick={postComment} disabled={postingComment || !newComment.trim()} className="!px-3 !py-1.5 !text-xs">
                {postingComment ? 'Posting…' : 'Post'}
              </Button>
            </div>
          </div>

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
      {showViewers && <AnnouncementViewersModal announcementId={announcementId} onClose={() => setShowViewers(false)} />}
    </Modal>
  )
}
