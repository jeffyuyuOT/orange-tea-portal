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

const TABS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sent', label: 'Sent' },
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
  const [search, setSearch] = useState('')
  // Jeff, 2026-09: "同一訊息reply，在inbox跟sent裡面是不是要以第一封為主，
  // 下拉展開" — which thread-root rows are currently expanded to show their
  // replies. Keyed by root message id, shared across both tabs (each tab
  // just looks up its own entries).
  const [expandedRootIds, setExpandedRootIds] = useState(new Set())

  const storeNameById = useMemo(() => new Map(accessibleStores.map((s) => [s.id, s.name])), [accessibleStores])

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [{ data: receivedRows }, { data: sent }] = await Promise.all([
        supabase
          .from('message_recipients')
          .select('read_at, message:messages(*, support_request:support_requests(id, case_number, completed))')
          .eq('profile_id', profile.id),
        supabase
          .from('messages')
          .select('*, support_request:support_requests(id, case_number, completed)')
          .eq('sender_id', profile.id)
          .order('created_at', { ascending: false }),
      ])

      const received = (receivedRows ?? [])
        .filter((r) => r.message)
        .map((r) => ({ ...r.message, readAt: r.read_at }))
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

  const rawItems = tab === 'inbox' ? inboxItems : sentItems
  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rawItems.filter((item) => {
      if (storeFilter && item.store_id !== storeFilter) return false
      if (!q) return true
      const counterpartNames =
        tab === 'inbox' ? item.sender_name ?? '' : (item.toProfiles ?? []).map((p) => nameOf(p, item.store_id, nameByStoreProfile)).join(' ')
      return item.subject.toLowerCase().includes(q) || counterpartNames.toLowerCase().includes(q)
    })
  }, [rawItems, storeFilter, search, tab, nameByStoreProfile])

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
  // to reveal.
  function renderRow(item, { nested = false, supportBadge = null, threadCount = 0, expanded = false, onToggle = null } = {}) {
    const unread = tab === 'inbox' && !item.readAt
    const isReply = !!item.in_reply_to
    const toNames = tab === 'sent' ? (item.toProfiles ?? []).map((p) => nameOf(p, item.store_id, nameByStoreProfile)) : []
    return (
      <button
        key={item.id}
        onClick={() => setOpenMessageId(item.id)}
        className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-brand-50 sm:flex-row sm:items-center sm:justify-between ${
          nested ? 'bg-brand-50/40 pl-9' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
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
          {tab === 'sent' ? `To: ${toNames.join(', ') || '—'}` : `From: ${item.sender_name}`} ·{' '}
          {new Date(item.created_at).toLocaleString()}
        </span>
      </button>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button onClick={() => setComposing(true)}>+ New message</Button>
      </div>

      {/* Store filter — hidden entirely for someone with access to only
          one store, since there'd be nothing to filter — and a search box
          over subject + the other party's name, per Jeff's spec for
          managing messages across several stores at once. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        <EmptyState label={rawItems.length ? 'No messages match.' : tab === 'inbox' ? 'No messages received yet.' : 'No messages sent yet.'} />
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
