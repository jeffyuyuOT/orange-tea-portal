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

// Jeff, 2026-10-30: pulls the current plain text back OUT of a merged
// comment's stored HTML block (by its data-comment-id — see
// append_merged_comment()/edit_merged_comment(), migrations 0157/0159/
// 0161) so the "Edit" button on that History entry can pre-fill an
// editable plain-text box with it, the same way editingCommentText
// already works for the ordinary (non-merge) Comments list below.
// <br/> tags are turned back into real newlines first — the reverse of
// what those two SQL functions do to a newline you type — before reading
// textContent, which itself already reverses the &amp;/&lt;/&gt; escaping.
function extractMergedCommentText(html, historyId) {
  if (!html || typeof document === 'undefined') return ''
  const container = document.createElement('div')
  container.innerHTML = html
  const target = container.querySelector(`[data-comment-id="${CSS.escape(String(historyId))}"]`)
  if (!target) return ''
  target.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  return target.textContent ?? ''
}

export default function AnnouncementDetailModal({ announcementId, storeId, onClose, onSaved }) {
  const { profile, accessibleStores } = useAuth()
  const isNew = !announcementId
  // developer counts as manager/admin here too — see BulletinPage.jsx's
  // matching comment (Jeff, 2026-09: developer couldn't edit/delete their
  // own post's manager-only bits, or see "View history", for the same
  // reason posting was broken for them).
  const isManagerOrAdmin = profile?.role === 'admin' || profile?.role === 'shop_manager' || profile?.role === 'developer'
  // Jeff, 2026-10-30: "admin可以在notice勾取，將comment併至內文的選項" —
  // deliberately narrower than isManagerOrAdmin above (shop_manager does
  // NOT get this one) — same "developer counts as admin" convention the
  // rest of this file already uses for everything else, just without
  // shop_manager this time since Jeff said "admin" specifically.
  const isAdmin = profile?.role === 'admin' || profile?.role === 'developer'
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
  // Jeff, 2026-10-30: per-notice, admin-only "merge comments into content"
  // toggle (migration 0157) — see postMergedComment() and the Comments
  // section below for what it actually changes.
  const [mergeComments, setMergeComments] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  // Jeff, 2026-10-30: which merged-in comment block (if any) the History
  // list's click should highlight in the content above — see RichTextViewer's
  // own comment on data-comment-id/highlightId for the actual DOM work.
  const [highlightedCommentId, setHighlightedCommentId] = useState(null)
  // Jeff, 2026-10-30: "Merge加的comment發文者也要可以編輯跟刪除" — editing a
  // merged comment (see editingHistoryCommentId's History-row UI below)
  // is a separate state from editingCommentId/editingCommentText above —
  // those two are for the ordinary (non-merge) Comments list, which saves
  // straight to announcement_comments; this one calls edit_merged_comment()
  // (migration 0161) instead, so they're kept apart rather than shared.
  const [editingHistoryCommentId, setEditingHistoryCommentId] = useState(null)
  const [editingHistoryCommentText, setEditingHistoryCommentText] = useState('')
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
  // delete announcements" RLS policy for manager/admin — any manager/admin
  // with access to this store, not just the original poster — and per the
  // "staff delete own announcements" policy for a staff creator, which is
  // their own post only), so the button is really always available to
  // canManageThis; only the label changes to reflect that the creator is
  // "retracting" their own post rather than moderating someone else's.
  // Jeff, 2026-10-30 (delete is unchanged — this is about EDIT only).
  const deleteLabel = isCreator ? 'Retract' : 'Delete'
  // Jeff, 2026-10-30: "manager的edit權限拿掉，只保留給admin跟發文者。發文者
  // 在有人comment之後就無法edit訊息(admin除外)" — a plain shop_manager who
  // isn't this post's own creator can no longer edit it at all (RLS:
  // migration 0162 drops their old blanket "any post at this store" UPDATE
  // right down to admin-only); the creator keeps editing their own post,
  // but only until the first comment lands on it — a regular
  // announcement_comments row OR a merge-mode 'commented' history entry
  // both count as "someone commented", since either way the post has a
  // reply on record now. Admin/developer is exempt from that lock and can
  // always edit. canManageThis above is untouched on purpose — it still
  // gates the whole footer (Delete/View history stay exactly as broad as
  // before); this is only about whether the Edit button itself shows.
  const hasAnyComments = comments.length > 0 || history.some((h) => h.action === 'commented')
  const canEditThis = isAdmin || (isCreator && !hasAnyComments)
  const categorySelectValue = isComplaint ? 'customer_complaint' : isImportant ? 'important' : 'normal'

  useEffect(() => {
    setHighlightedCommentId(null)
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
          setMergeComments(!!data.merge_comments_into_content)
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
    //
    // Jeff, 2026-10-03: a staff tester's "Store Announcement" kept showing
    // New even after opening it — announcement_reads had zero rows for that
    // account despite the table/RLS being fine (and the identical pattern
    // on roster_period_views working for the same account), so the most
    // likely explanation is this call silently failing or silently not
    // firing (e.g. `profile` not loaded yet on first mount — it wasn't in
    // this effect's own dependency list, below) with nothing logged either
    // way. Added `profile?.id` to the deps (so a late-loading profile still
    // triggers this) and error logging (so a real failure next time shows
    // up in the console instead of just silently leaving the badge stuck).
    // Separately found while chasing the same report: announcement_reads had
    // an INSERT policy and a SELECT policy for a profile's own rows, but no
    // UPDATE policy — so re-upserting an ALREADY-read row (reopening the
    // same announcement a second time, or the "Update" badge's
    // re-read-after-edit case) hit the upsert's ON CONFLICT...DO UPDATE arm
    // with nothing in RLS permitting it, and failed too. Added a matching
    // "update own announcement_reads" policy (2026-10-03 migration).
    //
    // Jeff, 2026-10-03 (same-day follow-up): "如果是群發分店的訊息，有多家
    // 分店的user只要在其中一家看過後，則其他分店相同訊息都判定為已閱讀" — a
    // broadcast to N stores (see save()'s isNew branch) is N independent
    // rows with their own ids, so marking THIS row read never touched its
    // siblings' own read receipts — a user who belongs to more than one of
    // the broadcast's stores had to separately "read" every store's copy.
    // Once broadcast_group_id ties sibling rows together, opening any ONE
    // of them now also upserts a read receipt for every other sibling row —
    // scoped to `current_store_ids()` via the same "read same-store
    // announcements" RLS policy the plain select below already relies on,
    // so this only ever reaches siblings this profile can actually see
    // (i.e. stores they belong to), never ones they don't.
    if (profile?.id) {
      supabase
        .from('announcement_reads')
        .upsert({ profile_id: profile.id, announcement_id: announcementId, read_at: new Date().toISOString() }, { onConflict: 'profile_id,announcement_id' })
        .then(({ error }) => {
          if (error) console.error('Failed to mark announcement as read:', error)
        })
      supabase
        .from('announcements')
        .select('id, broadcast_group_id')
        .eq('id', announcementId)
        .maybeSingle()
        .then(({ data: thisAnnouncement }) => {
          if (!thisAnnouncement?.broadcast_group_id) return
          supabase
            .from('announcements')
            .select('id')
            .eq('broadcast_group_id', thisAnnouncement.broadcast_group_id)
            .neq('id', announcementId)
            .then(({ data: siblings, error: siblingsError }) => {
              if (siblingsError) {
                console.error('Failed to look up broadcast sibling announcements:', siblingsError)
                return
              }
              if (!siblings?.length) return
              const readAt = new Date().toISOString()
              supabase
                .from('announcement_reads')
                .upsert(
                  siblings.map((s) => ({ profile_id: profile.id, announcement_id: s.id, read_at: readAt })),
                  { onConflict: 'profile_id,announcement_id' }
                )
                .then(({ error: upsertError }) => {
                  if (upsertError) console.error('Failed to mark broadcast sibling announcements as read:', upsertError)
                })
            })
        })
    }
  }, [announcementId, isNew, profile?.id])

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
        // Jeff, 2026-10-03: "如果是群發分店的訊息，有多家分店的user只要在其中
        // 一家看過後，則其他分店相同訊息都判定為已閱讀" — a shared
        // broadcast_group_id ties this broadcast's N rows together so the
        // mark-as-read effect below can propagate one store's read receipt
        // to every sibling store's copy for a user who belongs to more than
        // one of them. Only actually a "broadcast" (and only ever needed)
        // when it's going to more than one store — a single-store post keeps
        // broadcast_group_id null, same as every row did before this column
        // existed.
        const broadcastGroupId = targetStoreIds.length > 1 ? crypto.randomUUID() : null
        for (const targetStoreId of targetStoreIds) {
          const { data, error } = await supabase
            .from('announcements')
            .insert({
              store_id: targetStoreId,
              title,
              content_html: content,
              is_important: isImportant,
              category,
              merge_comments_into_content: mergeComments,
              created_by: profile.id,
              created_by_name: actorName,
              updated_by: profile.id,
              updated_by_name: actorName,
              broadcast_group_id: broadcastGroupId,
            })
            .select()
            .single()
          if (error) throw error
          await supabase
            .from('announcement_history')
            .insert({ announcement_id: data.id, action: 'created', actor_id: profile.id, actor_name: actorName })
          // The poster has obviously already "seen" their own post — mark it
          // read for them so it doesn't show up flagged NEW on their own
          // Bulletin Board. Jeff, 2026-10-03: this and the two other
          // announcement_reads writes in this file used to swallow any
          // write error silently (no `{ error }` check) — now logged, same
          // as the mark-as-read effect above.
          const { error: readError } = await supabase.from('announcement_reads').upsert(
            { profile_id: profile.id, announcement_id: data.id },
            { onConflict: 'profile_id,announcement_id', ignoreDuplicates: true }
          )
          if (readError) console.error('Failed to mark announcement as read:', readError)
        }
      } else {
        const { error } = await supabase
          .from('announcements')
          .update({
            title,
            content_html: content,
            is_important: isImportant,
            category,
            // Jeff, 2026-10-30: only admin/developer ever gets the checkbox
            // that changes this (see the Edit form below), so a
            // manager/staff saving a normal edit just resends whatever was
            // already loaded — never silently flips it.
            merge_comments_into_content: mergeComments,
            updated_by: profile.id,
            updated_by_name: actorName,
          })
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
        const { error: readError } = await supabase
          .from('announcement_reads')
          .upsert({ profile_id: profile.id, announcement_id: announcementId, read_at: new Date().toISOString() }, { onConflict: 'profile_id,announcement_id' })
        if (readError) console.error('Failed to mark announcement as read:', readError)
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

  // Jeff, 2026-10-30: "將comment併至內文的選項，這樣新增的comment會像是edit
  // 的效果一樣直接加在原文裡" — when mergeComments is on, the SAME comment
  // box calls this instead of postComment() above: the comment never
  // becomes its own announcement_comments row at all, it's appended
  // straight onto content_html by append_merged_comment() (migration
  // 0157, SECURITY DEFINER — see that migration's comment for why this
  // can't just be a plain client .update()) and logged to
  // announcement_history as 'commented'. Re-fetches content_html +
  // history afterwards rather than re-building the same HTML client-side,
  // so this view can never drift from exactly what the RPC actually wrote
  // (its escaping, timestamp formatting, etc.).
  async function postMergedComment() {
    const body = newComment.trim()
    if (!body) return
    setPostingComment(true)
    const { error } = await supabase.rpc('append_merged_comment', {
      p_announcement_id: announcementId,
      p_comment: body,
    })
    if (error) {
      setPostingComment(false)
      alert(`Could not post comment: ${error.message}`)
      return
    }
    setNewComment('')
    const [{ data: refreshed }, { data: refreshedHistory }] = await Promise.all([
      supabase.from('announcements').select('content_html').eq('id', announcementId).single(),
      supabase
        .from('announcement_history')
        .select('*, actor:actor_id(first_name,last_name)')
        .eq('announcement_id', announcementId)
        .order('acted_at', { ascending: false }),
    ])
    setPostingComment(false)
    if (refreshed) setContent(refreshed.content_html ?? '')
    setHistory(refreshedHistory ?? [])
  }

  // Jeff, 2026-10-30: "發comment的人要有可以編輯或刪除comment的功能" — the
  // author-scoped update/delete RLS policies (migration 0157) make these
  // safe for anyone to call; a non-author's attempt is simply rejected by
  // RLS (the UI already only shows the buttons on the author's own
  // comments — see the Comments list below — but these aren't the only
  // thing standing between someone and another person's comment).
  async function saveCommentEdit(commentId) {
    const body = editingCommentText.trim()
    if (!body) return
    const { data, error } = await supabase
      .from('announcement_comments')
      .update({ content: body })
      .eq('id', commentId)
      .select('*, author:author_id(first_name,last_name)')
      .single()
    if (error) {
      alert(`Could not update comment: ${error.message}`)
      return
    }
    setComments((prev) => prev.map((c) => (c.id === commentId ? data : c)))
    setEditingCommentId(null)
  }

  async function deleteComment(commentId) {
    const { error } = await supabase.from('announcement_comments').delete().eq('id', commentId)
    if (error) {
      alert(`Could not delete comment: ${error.message}`)
      return
    }
    setComments((prev) => prev.filter((c) => c.id !== commentId))
  }

  // Jeff, 2026-10-30: "Merge加的comment發文者也要可以編輯跟刪除" — the
  // missing edit half of deleteMergedComment below, via edit_merged_
  // comment() (migration 0161, author-only — no manager/admin OR-clause,
  // same asymmetry saveCommentEdit above already has for the non-merge
  // case).
  async function saveMergedCommentEdit(historyId) {
    const body = editingHistoryCommentText.trim()
    if (!body) return
    const { error } = await supabase.rpc('edit_merged_comment', {
      p_announcement_id: announcementId,
      p_history_id: historyId,
      p_comment: body,
    })
    if (error) {
      alert(`Could not update comment: ${error.message}`)
      return
    }
    setEditingHistoryCommentId(null)
    const { data: refreshed } = await supabase.from('announcements').select('content_html').eq('id', announcementId).single()
    if (refreshed) setContent(refreshed.content_html ?? '')
  }

  // Jeff, 2026-10-30: "如果comment者刪除的話是不是歷史紀錄也要清楚" — a
  // merge-mode comment has no row of its own; deleting one means
  // stripping its block back out of content_html AND removing its
  // History row together, which delete_merged_comment() (migration 0160)
  // does as one SECURITY DEFINER transaction. Re-fetches afterwards, same
  // reasoning as postMergedComment() above (never hand-build what the
  // server already built/removed).
  async function deleteMergedComment(historyId) {
    const { error } = await supabase.rpc('delete_merged_comment', {
      p_announcement_id: announcementId,
      p_history_id: historyId,
    })
    if (error) {
      alert(`Could not delete comment: ${error.message}`)
      return
    }
    if (highlightedCommentId === historyId) setHighlightedCommentId(null)
    const [{ data: refreshed }, { data: refreshedHistory }] = await Promise.all([
      supabase.from('announcements').select('content_html').eq('id', announcementId).single(),
      supabase
        .from('announcement_history')
        .select('*, actor:actor_id(first_name,last_name)')
        .eq('announcement_id', announcementId)
        .order('acted_at', { ascending: false }),
    ])
    if (refreshed) setContent(refreshed.content_html ?? '')
    setHistory(refreshedHistory ?? [])
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
      title={isNew ? 'New Notice' : editing ? 'Edit Notice' : title}
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
            {canEditThis && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
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
          {/* Jeff, 2026-10-30: "admin或發文者要有edit跟comment兩個選項，因為
              這兩個是不同的動作...而且edit的話還是可以在comment merge下更改
              內容，只有comment才鎖住原文" — "原文不能改,只能插入或加" (the
              original text can only be grown, never rewritten) is a rule
              about the COMMENT action specifically (postMergedComment
              below, which is all a plain viewer without edit rights ever
              gets) — it was never meant to apply to an actual Edit by
              someone who has edit rights (admin, or the creator before
              the first comment — see canEditThis above). This form is
              only reachable via that Edit button in the first place, so
              the rich text editor now always renders here regardless of
              mergeComments — editing and commenting are two separate,
              simultaneously-available actions (the view below this form
              still has both: this Edit form, and the Comments box), not
              a locked/unlocked toggle on the same one. */}
          <SimpleRichTextEditor
            value={content}
            onChange={setContent}
            placeholder="Notice content…"
            imageUploadPath={`announcements/${storeId}`}
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} />
            Mark as important
          </label>
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={mergeComments} onChange={(e) => setMergeComments(e.target.checked)} />
              Merge comments into content (admin only)
            </label>
          )}
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
            {/* Jeff, 2026-10-27: "bulletin notice裡的important標籤改成星星
                顯示" — same ★ marker as the list row (BulletinPage.jsx). */}
            {isImportant && (
              <span
                className="shrink-0 text-xl leading-none text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.9)]"
                title="Important"
                aria-label="Important"
              >
                ★
              </span>
            )}
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

          <RichTextViewer html={content} highlightId={highlightedCommentId} />

          {/* Jeff, 2026-10-30: tells the creator themselves why the Edit
              button above just disappeared — admin never sees this (they're
              exempt from the lock), and it's only meaningful to the person
              who actually lost the ability. */}
          {isCreator && !isAdmin && hasAnyComments && (
            <p className="text-xs text-gray-400">
              Editing is locked now that this notice has a comment — ask an admin if it needs changes.
            </p>
          )}

          {/* "Supplement" comments (migration 0056) — anyone who can see
              this post can add one here, regardless of who created it;
              this is separate from Edit/Save above, which stays limited to
              the creator + manager/admin.
              Jeff, 2026-10-30: while mergeComments is on (admin-only
              checkbox in the Edit form above), this box no longer creates
              its own announcement_comments row at all — the list below is
              hidden and Post instead calls postMergedComment(), which
              appends straight onto the notice's own content above (see
              that function's own comment). Existing rows from before
              merge-mode was turned on, if any, are left in the database
              untouched but simply aren't shown while it's on. */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-400">Comments</h4>
            {!mergeComments && (
              <ul className="mb-2 space-y-1.5">
                {comments.map((c) => {
                  const isOwnComment = !!profile && profile.id === c.author_id
                  const authorLabel =
                    c.author_name || (c.author ? `${c.author.first_name ?? ''} ${c.author.last_name ?? ''}`.trim() : 'Unknown')
                  if (editingCommentId === c.id) {
                    return (
                      <li key={c.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                        <input
                          value={editingCommentText}
                          onChange={(e) => setEditingCommentText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveCommentEdit(c.id)}
                          autoFocus
                          className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none"
                        />
                        <div className="mt-1.5 flex gap-2">
                          <button
                            type="button"
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            onClick={() => saveCommentEdit(c.id)}
                            disabled={!editingCommentText.trim()}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="text-xs font-medium text-gray-400 hover:text-gray-600"
                            onClick={() => setEditingCommentId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </li>
                    )
                  }
                  return (
                    <li key={c.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                      <p className="whitespace-pre-wrap text-gray-700">{c.content}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                        <span>
                          {authorLabel} · {new Date(c.created_at).toLocaleString()}
                        </span>
                        {/* Jeff, 2026-10-30: "發comment的人要有可以編輯或刪
                            除comment的功能" — the comment's own author can
                            edit or delete it; manager/admin get delete too
                            (moderation — the RLS policy for this already
                            existed, migration 0056, it just had no UI entry
                            point until now), but never edit on someone
                            else's words. */}
                        {isOwnComment && (
                          <button
                            type="button"
                            className="font-medium text-brand-600 hover:text-brand-700"
                            onClick={() => {
                              setEditingCommentId(c.id)
                              setEditingCommentText(c.content)
                            }}
                          >
                            Edit
                          </button>
                        )}
                        {(isOwnComment || isManagerOrAdmin) && (
                          <button
                            type="button"
                            className="font-medium text-gray-400 hover:text-red-500"
                            onClick={() => deleteComment(c.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
                {!comments.length && <li className="text-xs text-gray-400">No comments yet.</li>}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (mergeComments ? postMergedComment() : postComment())}
                placeholder="Add a comment…"
                disabled={postingComment}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
              />
              <Button
                onClick={mergeComments ? postMergedComment : postComment}
                disabled={postingComment || !newComment.trim()}
                className="!px-3 !py-1.5 !text-xs"
              >
                {postingComment ? 'Posting…' : 'Post'}
              </Button>
            </div>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-400">History</h4>
            <ul className="space-y-1 text-xs text-gray-500">
              {/* Jeff, 2026-10-30: "如果想知道哪一段留言是誰加的，可以點擊
                  該歷史紀錄（顯示highlight），然後該記錄編輯的文字也
                  highlight" — only a 'commented' entry has a matching
                  data-comment-id block to find in the content above (a
                  plain edit/created/solved entry touched no single
                  identifiable block), so only those are clickable; a
                  second click on the same entry un-highlights it. */}
              {history.map((h) => {
                const isCommentEntry = h.action === 'commented'
                const isHighlighted = isCommentEntry && highlightedCommentId === h.id
                const isOwnComment = isCommentEntry && profile?.id === h.actor_id
                const canDeleteThisComment = isCommentEntry && (isOwnComment || isManagerOrAdmin)

                if (editingHistoryCommentId === h.id) {
                  return (
                    <li key={h.id} className="rounded bg-gray-50 px-1.5 py-1">
                      <input
                        value={editingHistoryCommentText}
                        onChange={(e) => setEditingHistoryCommentText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveMergedCommentEdit(h.id)}
                        autoFocus
                        className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-400 focus:outline-none"
                      />
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          className="font-medium text-brand-600 hover:text-brand-700"
                          onClick={() => saveMergedCommentEdit(h.id)}
                          disabled={!editingHistoryCommentText.trim()}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="font-medium text-gray-400 hover:text-gray-600"
                          onClick={() => setEditingHistoryCommentId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </li>
                  )
                }
                return (
                  <li
                    key={h.id}
                    className={`flex items-center gap-1.5 ${isHighlighted ? '-mx-1 rounded bg-yellow-100 px-1 font-medium text-gray-700' : ''}`}
                  >
                    <span
                      onClick={isCommentEntry ? () => setHighlightedCommentId((prev) => (prev === h.id ? null : h.id)) : undefined}
                      className={isCommentEntry ? 'cursor-pointer hover:text-brand-600' : ''}
                    >
                      {new Date(h.acted_at).toLocaleString()} — {h.action.replace('_', ' ')} by{' '}
                      {h.actor_name || (h.actor ? `${h.actor.first_name ?? ''} ${h.actor.last_name ?? ''}`.trim() : 'Unknown')}
                    </span>
                    {/* Jeff, 2026-10-30: "Merge加的comment發文者也要可以編
                        輯跟刪除" — Edit is author-only (never manager/
                        admin on someone else's words, same as the
                        non-merge Comments list above); Delete keeps its
                        existing author-or-manager/admin rule. */}
                    {isOwnComment && (
                      <button
                        type="button"
                        className="font-medium text-brand-600 hover:text-brand-700"
                        onClick={() => {
                          setEditingHistoryCommentId(h.id)
                          setEditingHistoryCommentText(extractMergedCommentText(content, h.id))
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {canDeleteThisComment && (
                      <button
                        type="button"
                        className="font-medium text-gray-400 hover:text-red-500"
                        onClick={() => deleteMergedComment(h.id)}
                      >
                        Delete
                      </button>
                    )}
                  </li>
                )
              })}
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
