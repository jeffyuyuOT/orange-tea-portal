import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import ComposeMessageModal from './ComposeMessageModal'
import MessageDetailModal from './MessageDetailModal'
import { rosterDisplayName } from '../../../lib/excelRoster'

// Jeff, 2026-09: "message的user名稱會依照display name顯示" — same per-store
// Name Display setting as everywhere else on the roster. `nameByStoreProfile`
// is keyed by `${store_id}:${profile_id}` since a Sent list can span more
// than one store and the same person can have a different display name at
// each — see the lookup map built below.
function nameOf(p, storeId, nameByStoreProfile) {
  if (!p) return 'Unknown'
  const withDisplayName = { ...p, roster_display_name: nameByStoreProfile?.get(`${storeId}:${p.id}`) }
  return rosterDisplayName(withDisplayName) || p.email || 'Unknown'
}

// Jeff, 2026-10-01: "message裡除了inbox跟sent，新增Important tab" — Important
// shows starred items from EITHER side (received or sent), so it sits after
// both source tabs rather than being its own separate data source.
const TABS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sent', label: 'Sent' },
  { key: 'important', label: 'Important' },
]

// Jeff, 2026-09: Message moved out of Bulletin Board into its own "My
// Dashboard" page — Inbox/Sent, email-style rows (title/sender-or-
// recipients/time), a "+ New message" button reusing the same
// recipient-picker compose flow Bulletin's Message tab used
// (ComposeMessageModal, unchanged). Personal scope — every query here is
// keyed by profile.id only, never filtered to currentStoreId, since a
// message belongs to the person, not to whichever store they happen to be
// switched to right now (see storeId comments on ComposeMessageModal /
// MessageDetailModal — that prop is only about who's ELIGIBLE to receive a
// brand-new message, not about which existing messages this page lists).
//
// Jeff, 2026-09 (later same day): since Message is personal/cross-store,
// added a store tag per row + a store filter (hidden entirely for someone
// with access to only one store — nothing to filter) + a search box
// (subject, or the other party's name) so someone managing several stores
// can still find one message ("以方便多家店的user去管理"). Also surfaces a
// Complete/Incomplete badge for a Support-request message (migration
// 0069_support_requests.sql) alongside the existing New/Update badge.
//
// Jeff, 2026-10-01: "message可以刪除，並支持多重選擇的功能。...訊息清單的
// 訊息左邊顯示星星跟垃圾桶圖案。星星代表將此訊息標註成important...垃圾桶代
// 表刪除。如果多重選擇訊息的時候刪除選項會出現在important tab旁邊" — every
// row now carries a checkbox (multi-select), a star (toggle Important) and
// a trash icon (soft delete) on its left; a "Delete selected" button
// appears next to the tab pills whenever anything's checked. Each item
// carries its own `origin` ('received' or 'sent', set when inboxItems/
// sentItems are built below) so these actions — and the Important tab,
// which mixes both — know whether to write to message_recipients (my own
// copy as a recipient) or messages (my own copy as the sender); see
// migration 0085_message_important_and_delete.sql for why each side needs
// its own pair of columns.
export default function MessagePage() {
  const { profile, currentStoreId, accessibleStores, refreshUnreadMessages } = useAuth()
  const [tab, setTab] = useState('inbox')
  const [loading, setLoading] = useState(true)
  const [inboxItems, setInboxItems] = useState([])
  const [sentItems, setSentItems] = useState([])
  const [nameByStoreProfile, setNameByStoreProfile] = useState(new Map())
  const [openMessageId, setOpenMessageId] = useState(null)
  const [composing, setComposing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [storeFilter, setStoreFilter] = useState('')
  // Jeff, 2026-09: "message裡新增日期篩選在store篩選前面" — a from/to date
  // range filter, placed before the store filter in the row below. Compares
  // against each message's created_at (its own calendar day, in the
  // viewer's local time — same as how the row itself displays the date via
  // toLocaleString()), inclusive on both ends.
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  // Jeff, 2026-09: "同一訊息reply，在inbox跟sent裡面是不是要以第一封為主，
  // 下拉展開" — which thread-root rows are currently expanded to show their
  // replies. Keyed by root message id, shared across both tabs (each tab
  // just looks up its own entries).
  const [expandedRootIds, setExpandedRootIds] = useState(new Set())
  // Jeff, 2026-10-01: checked rows for bulk delete — cleared whenever the
  // tab switches (see the tab button's onClick below) so a selection made
  // in one tab can't silently carry into another.
  const [selectedIds, setSelectedIds] = useState(new Set())

  const storeNameById = useMemo(() => new Map(accessibleStores.map((s) => [s.id, s.name])), [accessibleStores])

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [{ data: receivedRows }, { data: sent }] = await Promise.all([
        supabase
          .from('message_recipients')
          .select('read_at, is_important, message:messages(*, support_request:support_requests(id, case_number, completed))')
          .eq('profile_id', profile.id)
          .is('deleted_at', null),
        supabase
          .from('messages')
          .select('*, support_request:support_requests(id, case_number, completed)')
          .eq('sender_id', profile.id)
          .is('sender_deleted_at', null)
          .order('created_at', { ascending: false }),
      ])

      const received = (receivedRows ?? [])
        .filter((r) => r.message)
        .map((r) => ({ ...r.message, readAt: r.read_at, isImportant: r.is_important, origin: 'received' }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

      const sentRows = sent ?? []
      // "To:" list for sent items — a separate query since Supabase can't
      // follow messages -> message_recipients -> profiles the other
      // direction in one select.
      let recipientNamesByMessage = new Map()
      if (sentRows.length) {
        const { data: recRows } = await supabase
          .from('message_recipients')
          .select('message_id, profiles(id, first_name, last_name, email)')
          .in(
            'message_id',
            sentRows.map((m) => m.id)
          )
        recipientNamesByMessage = new Map()
        ;(recRows ?? []).forEach((r) => {
          const list = recipientNamesByMessage.get(r.message_id) ?? []
          list.push(r.profiles)
          recipientNamesByMessage.set(r.message_id, list)
        })
      }

      // Per-store display names (Roster Hub > Setting > Name Display) for
      // every store any of these messages belongs to — Inbox's "From:" is
      // already a permanent snapshot (sender_name) so this is really only
      // for Sent's "To:" list, but fetching for both sides' store_ids
      // keeps this correct if that ever changes.
      const storeIds = Array.from(new Set([...received, ...sentRows].map((m) => m.store_id).filter(Boolean)))
      let nameMap = new Map()
      if (storeIds.length) {
        const { data: nameRows } = await supabase
          .from('user_stores')
          .select('store_id, profile_id, roster_display_name')
          .in('store_id', storeIds)
        nameMap = new Map((nameRows ?? []).map((r) => [`${r.store_id}:${r.profile_id}`, r.roster_display_name]))
      }

      if (!cancelled) {
        setInboxItems(received)
        setSentItems(
          sentRows.map((m) => ({
            ...m,
            toProfiles: recipientNamesByMessage.get(m.id) ?? [],
            isImportant: m.sender_is_important,
            origin: 'sent',
          }))
        )
        setNameByStoreProfile(nameMap)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profile?.id, refreshKey])

  function reload() {
    setRefreshKey((k) => k + 1)
    refreshUnreadMessages?.()
  }

  // Jeff, 2026-10-01: star toggles write to whichever side this copy
  // actually belongs to — message_recipients.is_important when it's my own
  // received copy, messages.sender_is_important when it's my own sent
  // copy — never the other party's row.
  async function toggleImportant(item, e) {
    e.stopPropagation()
    const next = !item.isImportant
    if (item.origin === 'received') {
      await supabase.from('message_recipients').update({ is_important: next }).eq('message_id', item.id).eq('profile_id', profile.id)
    } else {
      await supabase.from('messages').update({ sender_is_important: next }).eq('id', item.id).eq('sender_id', profile.id)
    }
    reload()
  }

  // Soft-deletes (sets a timestamp, doesn't actually remove the row) a
  // batch of items, split by origin into the two tables that carry each
  // side's own "deleted" marker.
  async function deleteItems(itemsToDelete) {
    const receivedIds = itemsToDelete.filter((i) => i.origin === 'received').map((i) => i.id)
    const sentIds = itemsToDelete.filter((i) => i.origin === 'sent').map((i) => i.id)
    const now = new Date().toISOString()
    await Promise.all([
      receivedIds.length
        ? supabase.from('message_recipients').update({ deleted_at: now }).eq('profile_id', profile.id).in('message_id', receivedIds)
        : Promise.resolve(),
      sentIds.length
        ? supabase.from('messages').update({ sender_deleted_at: now }).eq('sender_id', profile.id).in('id', sentIds)
        : Promise.resolve(),
    ])
    setSelectedIds(new Set())
    reload()
  }

  function deleteOne(item, e) {
    e.stopPropagation()
    if (!confirm('Delete this message?')) return
    deleteItems([item])
  }

  async function deleteSelected() {
    const byId = new Map([...inboxItems, ...sentItems].map((i) => [i.id, i]))
    const toDelete = Array.from(selectedIds)
      .map((id) => byId.get(id))
      .filter(Boolean)
    if (!toDelete.length) return
    if (!confirm(`Delete ${toDelete.length} selected message(s)?`)) return
    await deleteItems(toDelete)
  }

  function toggleSelected(id, e) {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const importantItems = useMemo(() => [...inboxItems, ...sentItems].filter((i) => i.isImportant), [inboxItems, sentItems])
  const rawItems = tab === 'inbox' ? inboxItems : tab === 'sent' ? sentItems : importantItems
  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rawItems.filter((item) => {
      if (dateFrom && new Date(item.created_at) < new Date(`${dateFrom}T00:00:00`)) return false
      if (dateTo && new Date(item.created_at) > new Date(`${dateTo}T23:59:59.999`)) return false
      if (storeFilter && item.store_id !== storeFilter) return false
      if (!q) return true
      const counterpartNames =
        item.origin === 'received' ? item.sender_name ?? '' : (item.toProfiles ?? []).map((p) => nameOf(p, item.store_id, nameByStoreProfile)).join(' ')
      return item.subject.toLowerCase().includes(q) || counterpartNames.toLowerCase().includes(q)
    })
  }, [rawItems, dateFrom, dateTo, storeFilter, search, nameByStoreProfile])

  // Jeff, 2026-09: "同一訊息reply，在inbox跟sent裡面是不是要以第一封為主，下
  // 拉展開，這樣才會知道是同一個主題" — group each tab's own rows by thread
  // root instead of leaving every reply as its own separate flat row sorted
  // purely by recency (which scatters a conversation and reorders it,
  // newest first). `allKnownById` is EVERY message this person can see across
  // BOTH tabs (not just the active one) — needed because a reply's direct
  // parent (in_reply_to) is very often a message that landed in the OTHER
  // tab (e.g. jeff-test's own follow-up in Sent replies to Jeff's reply,
  // which is an Inbox item for jeff-test) — walking through the combined
  // pool still resolves it back to the true thread root even though that
  // in-between message is never itself shown in either tab's group.
  const allKnownById = useMemo(() => {
    const m = new Map()
    for (const item of inboxItems) m.set(item.id, item)
    for (const item of sentItems) m.set(item.id, item)
    return m
  }, [inboxItems, sentItems])

  function rootIdOf(message) {
    let current = message
    const seen = new Set()
    while (current?.in_reply_to && !seen.has(current.id) && allKnownById.has(current.in_reply_to)) {
      seen.add(current.id)
      current = allKnownById.get(current.in_reply_to)
    }
    return current?.id ?? message.id
  }

  // A Support case's Incomplete/Complete badge only ever lives on the
  // ORIGINAL submission message — a reply never carries its own
  // support_request_id (see ComposeMessageModal.jsx) — so a lone reply row
  // (e.g. jeff-test's Inbox only ever has Jeff's reply, never the original
  // case they themselves submitted) used to show no status at all. Jeff:
  // "imcomplete跟complete的badge就算沒有對應到reply的訊息至少也知道是屬於
  // 第一個訊息下(會有badge狀態)的" — look the badge up by thread root
  // instead of by the individual row, so every row in a case's thread shows
  // its status even if that particular message isn't the one carrying it.
  const supportByRoot = useMemo(() => {
    const m = new Map()
    for (const item of allKnownById.values()) {
      if (item.support_request) m.set(rootIdOf(item), item.support_request)
    }
    return m
  }, [allKnownById]) // eslint-disable-line react-hooks/exhaustive-deps

  // Folds `items` (already search/store-filtered) into one row per thread —
  // the earliest message THIS TAB has for that root as the primary row, any
  // others as `replies` (oldest first) revealed by expanding it. A thread
  // with only one message in this tab renders with no expand affordance at
  // all, same as a plain flat row before this change.
  const groupedItems = useMemo(() => {
    const byRoot = new Map()
    for (const item of items) {
      const rootId = rootIdOf(item)
      if (!byRoot.has(rootId)) byRoot.set(rootId, [])
      byRoot.get(rootId).push(item)
    }
    return Array.from(byRoot.entries())
      .map(([rootId, groupItems]) => {
        const sorted = [...groupItems].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        const latestAt = Math.max(...groupItems.map((g) => new Date(g.created_at).getTime()))
        return { rootId, primary: sorted[0], replies: sorted.slice(1), latestAt }
      })
      .sort((a, b) => b.latestAt - a.latestAt)
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleExpanded(rootId, e) {
    e.stopPropagation()
    setExpandedRootIds((prev) => {
      const next = new Set(prev)
      if (next.has(rootId)) next.delete(rootId)
      else next.add(rootId)
      return next
    })
  }

  // One row, shared by a group's primary message and its (optionally)
  // expanded replies — `supportBadge` is looked up by thread root (see
  // above), never the row's own item, and `threadCount`/`expanded`/`onToggle`
  // are only passed for a group's primary row when it actually has replies
  // to reveal. The row itself is a plain div (not a <button>) so the
  // checkbox/star/trash controls on its left can be real interactive
  // elements without illegally nesting a button inside a button.
  function renderRow(item, { nested = false, supportBadge = null, threadCount = 0, expanded = false, onToggle = null } = {}) {
    const unread = item.origin === 'received' && !item.readAt
    const isReply = !!item.in_reply_to
    const toNames = item.origin === 'sent' ? (item.toProfiles ?? []).map((p) => nameOf(p, item.store_id, nameByStoreProfile)) : []
    const selected = selectedIds.has(item.id)
    return (
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        onClick={() => setOpenMessageId(item.id)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpenMessageId(item.id)}
        className={`flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left hover:bg-brand-50 sm:flex-row sm:items-center sm:justify-between ${
          nested ? 'bg-brand-50/40 pl-9' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => toggleSelected(item.id, e)}
            className="shrink-0"
          />
          <button
            type="button"
            onClick={(e) => toggleImportant(item, e)}
            title={item.isImportant ? 'Unmark Important' : 'Mark Important'}
            className={`shrink-0 text-base leading-none ${item.isImportant ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}
          >
            {item.isImportant ? '★' : '☆'}
          </button>
          <button
            type="button"
            onClick={(e) => deleteOne(item, e)}
            title="Delete"
            className="shrink-0 text-gray-300 hover:text-red-500"
          >
            🗑
          </button>
          {threadCount > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => onToggle(e)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle(e)}
              className="shrink-0 text-gray-400 hover:text-brand-600"
              title={expanded ? 'Hide replies' : `Show ${threadCount} more in this thread`}
            >
              {expanded ? '▾' : '▸'}
            </span>
          )}
          {unread && <Badge color="red">{isReply ? 'Update' : 'New'}</Badge>}
          {supportBadge && (
            <Badge color={supportBadge.completed ? 'green' : 'red'}>{supportBadge.completed ? 'Complete' : 'Incomplete'}</Badge>
          )}
          <span className={`font-medium ${unread ? 'text-gray-900' : 'text-gray-700'}`}>{item.subject}</span>
          {/* Which store this message belongs to — helps someone
              managing several stores tell them apart at a glance. */}
          <Badge color="gray">{storeNameById.get(item.store_id) ?? 'Unknown store'}</Badge>
          {threadCount > 0 && !expanded && <span className="text-xs text-gray-400">+{threadCount} in thread</span>}
        </div>
        <span className="shrink-0 text-xs text-gray-400">
          {item.origin === 'sent' ? `To: ${toNames.join(', ') || '—'}` : `From: ${item.sender_name}`} ·{' '}
          {new Date(item.created_at).toLocaleString()}
        </span>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key)
                  setSelectedIds(new Set())
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* Jeff, 2026-10-01: "如果多重選擇訊息的時候刪除選項會出現在
              important tab旁邊" — a bulk-delete button appears right next to
              the tab pills (which include Important) the moment anything's
              checked, and disappears again once the selection's cleared. */}
          {selectedIds.size > 0 && (
            <Button variant="danger" onClick={deleteSelected}>
              Delete selected ({selectedIds.size})
            </Button>
          )}
        </div>
        <Button onClick={() => setComposing(true)}>+ New message</Button>
      </div>

      {/* Date filter (from/to), then the store filter — hidden entirely for
          someone with access to only one store, since there'd be nothing to
          filter — then a search box over subject + the other party's name,
          per Jeff's spec for managing messages across several stores at once. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          {/* Jeff, 2026-10-02: "所有選日期的選項都要有防呆檢查" — same
              native min/max guard AttendanceLogTable's own From/To date
              filter already uses, so picking an end date earlier than the
              start (or vice versa) simply isn't selectable in the date
              picker, rather than silently returning zero/wrong results. */}
          <input
            type="date"
            className="input w-auto"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span className="text-sm text-gray-400">–</span>
          <input
            type="date"
            className="input w-auto"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom('')
                setDateTo('')
              }}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              Clear
            </button>
          )}
        </div>
        {accessibleStores.length > 1 && (
          <select className="input max-w-[12rem]" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
            <option value="">All stores</option>
            {accessibleStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject or name…"
          className="input max-w-xs"
        />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !items.length ? (
        <EmptyState
          label={
            rawItems.length
              ? 'No messages match.'
              : tab === 'inbox'
                ? 'No messages received yet.'
                : tab === 'sent'
                  ? 'No messages sent yet.'
                  : 'No important messages.'
          }
        />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {groupedItems.map(({ rootId, primary, replies }) => {
            const expanded = expandedRootIds.has(rootId)
            const supportBadge = supportByRoot.get(rootId)
            return (
              <div key={rootId}>
                {renderRow(primary, {
                  supportBadge,
                  threadCount: replies.length,
                  expanded,
                  onToggle: (e) => toggleExpanded(rootId, e),
                })}
                {expanded && replies.map((item) => renderRow(item, { nested: true, supportBadge }))}
              </div>
            )
          })}
        </div>
      )}

      {composing && (
        <ComposeMessageModal
          storeId={currentStoreId}
          senderProfile={profile}
          initial={{ subject: '', content: '', recipientIds: [], inReplyTo: null }}
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false)
            setTab('sent')
            reload()
          }}
        />
      )}
      {openMessageId && (
        <MessageDetailModal
          messageId={openMessageId}
          profile={profile}
          onClose={() => setOpenMessageId(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}
