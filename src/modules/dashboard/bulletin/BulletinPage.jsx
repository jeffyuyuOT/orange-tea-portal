import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addMonths } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { NON_PICKABLE_STAFF_ROLES } from '../../../lib/permissions'
import { getWorkedMinutesByProfile } from '../../../lib/attendance'
import { isActiveStoreMember } from '../../../lib/storeVisibility'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import AnnouncementDetailModal from './AnnouncementDetailModal'
import ImportantAnnouncementsModal from './ImportantAnnouncementsModal'
import RosterWeekTable from '../../roster-hub/shared/RosterWeekTable'

// Toggle filters shown to the user. There's no button for quiz reminders or
// training-hours reminders — those only ever appear in the unfiltered "all"
// view, same as any future message type that isn't roster/announcement/
// customer complaint.
const FILTERS = [
  { key: 'roster', label: 'Roster' },
  { key: 'announcement', label: 'Store Announcement' },
  { key: 'customer_complaint', label: 'Customer Complaint' },
]

const TYPE_BADGE = {
  announcement: { label: 'Announcement', color: 'brand' },
  roster: { label: 'Roster', color: 'green' },
  quiz_reminder: { label: 'Quiz Reminder', color: 'red' },
  training_hours: { label: 'Training Hours', color: 'red' },
  customer_complaint: { label: 'Customer Complaint', color: 'red' },
}

// Jeff's 100-hour standard training target — same number the Progress
// Chart's average learning curve and Learning Tracker's 70h warning are
// both built around (see ProgressChartModal.jsx / LearningTrackerPage.jsx).
const TRAINING_TARGET_HOURS = 100
// The reminder only starts appearing once someone's crossed this many
// hours — well before the 100h target, per Jeff's spec.
const TRAINING_REMINDER_START_HOURS = 50

// Unified Bulletin Board feed: merges store announcements, newly-submitted
// rosters, and (computed, not stored) quiz-attendance reminders into one
// newest-first list. Announcements and rosters drop out of the feed once
// they're more than a month old; quiz reminders instead stay until the
// person actually takes the quiz, since they describe current status, not a
// one-off posting. Important announcements are the other exception — they
// never drop out here either, matching the standalone "⭐ Important
// Announcements" picker (ImportantAnnouncementsModal.jsx), which never had a
// date filter at all. Jeff, 2026-09.
export default function BulletinPage() {
  const { currentStoreId, profile, refreshBulletinUpdates } = useAuth()
  const [filter, setFilter] = useState(null) // null = all, or 'roster' | 'announcement'
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [openAnnouncementId, setOpenAnnouncementId] = useState(null) // null closed, 'new', or uuid
  const [openRosterPeriod, setOpenRosterPeriod] = useState(null)
  const [showImportant, setShowImportant] = useState(false)

  // Jeff (2026-09): developer (Jeff Chuang) couldn't post an announcement at
  // all — this check only ever matched 'admin'/'shop_manager', never
  // 'developer', even though the database side (is_manager_or_admin(),
  // migration 0058) already treats developer as admin's superset for the
  // actual RLS write. The "manager admin write announcements" policy would
  // have accepted the insert fine; the button just never showed. Same fix
  // as the roster/Learning Tracker "developer excluded too narrowly" bugs
  // from earlier this session, just the opposite shape (a role missing from
  // an allow-list here, instead of present in a deny-list there).
  const isManagerOrAdmin = profile?.role === 'admin' || profile?.role === 'shop_manager' || profile?.role === 'developer'
  // Staff can post too now (migration 0056, per Jeff) — they just can only
  // edit/delete the posts they themselves created afterwards (enforced in
  // AnnouncementDetailModal.jsx + RLS), not anyone else's. There was
  // briefly a separate "Post and receive Bulletin messages" checkbox
  // (join_bulletin_activity, migrations 0065/0066) narrowing this further
  // — Jeff removed it the same day (migration
  // 0068_remove_bulletin_activity_checkbox.sql): it only ever affected
  // staff (admin/manager always bypassed the underlying RLS regardless),
  // and that was rare enough not to need its own toggle — a staff member
  // who genuinely shouldn't post/see Bulletin at all gets deactivated
  // instead. So this is back to a plain role check; the RLS's
  // current_store_ids() already guarantees they're actually at this store.
  const canPost = isManagerOrAdmin || profile?.role === 'staff'

  async function load() {
    if (!currentStoreId || !profile) return
    setLoading(true)

    const oneMonthAgo = addMonths(new Date(), -1).toISOString()

    const [{ data: announcementRows }, { data: importantAnnouncementRows }, { data: complaintRows }, { data: rosterRows }, { data: settingsRow }, { data: changeEventRows }, { data: periodViewRows }, { data: announcementReadRows }] = await Promise.all([
      supabase
        .from('announcements')
        .select('*, creator:created_by(first_name,last_name), editor:updated_by(first_name,last_name)')
        .eq('store_id', currentStoreId)
        .eq('category', 'normal')
        .gte('updated_at', oneMonthAgo)
        .order('updated_at', { ascending: false }),
      // Important announcements are exempt from the month cutoff above —
      // fetched separately (no date filter) and merged in below, deduped by
      // id, rather than folding the exemption into one `.or()` filter.
      supabase
        .from('announcements')
        .select('*, creator:created_by(first_name,last_name), editor:updated_by(first_name,last_name)')
        .eq('store_id', currentStoreId)
        .eq('category', 'normal')
        .eq('is_important', true)
        .order('updated_at', { ascending: false }),
      // Customer complaints don't drop out of the feed after a month like
      // everything else here — they stay visible (via their own tab) until
      // someone actually marks them solved.
      supabase
        .from('announcements')
        .select('*, creator:created_by(first_name,last_name), editor:updated_by(first_name,last_name)')
        .eq('store_id', currentStoreId)
        .eq('category', 'customer_complaint')
        .order('updated_at', { ascending: false }),
      supabase
        .from('roster_periods')
        .select('*, creator:created_by(first_name,last_name)')
        .eq('store_id', currentStoreId)
        .eq('status', 'submitted')
        .not('submitted_at', 'is', null)
        .gte('submitted_at', oneMonthAgo)
        .order('submitted_at', { ascending: false }),
      supabase.from('quiz_settings').select('reminder_period_months').eq('store_id', currentStoreId).maybeSingle(),
      // Per-period "Update" badges on individual Roster feed items (see
      // below) — each specific "Roster posted" row shows its own badge for
      // whichever weeks actually changed since THIS PERSON actually opened
      // THAT week (not just switched to the Roster tab — see
      // roster_period_views, migration 0048).
      supabase.from('roster_change_events').select('roster_period_id, changed_at').eq('store_id', currentStoreId),
      supabase.from('roster_period_views').select('roster_period_id, viewed_at').eq('profile_id', profile.id),
      // This person's own "last opened THIS announcement/complaint"
      // timestamp (migration 0056) — same New/Update pattern as the Roster
      // tab above, just keyed by announcement_id instead of roster period.
      supabase.from('announcement_reads').select('announcement_id, read_at').eq('profile_id', profile.id),
    ])

    const reminderMonths = settingsRow?.reminder_period_months ?? 3

    // Who to check for an overdue quiz: managers/admin see every active
    // staff member based at this store; a regular staff/training account
    // only ever sees their own reminder — both because we only ever fetch
    // their own profile here, and because RLS itself blocks them from
    // reading anyone else's profile or quiz_attempts rows.
    let staffRows = []
    if (isManagerOrAdmin) {
      const { data } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, hire_date, created_at')
        .eq('primary_store_id', currentStoreId)
        .eq('role', 'staff')
        .eq('is_active', true)
      staffRows = data ?? []
    } else if (profile.role === 'staff' || profile.role === 'training') {
      staffRows = [profile]
    }

    let quizReminders = []
    if (staffRows.length) {
      const ids = staffRows.map((s) => s.id)
      const { data: attemptRows } = await supabase.from('quiz_attempts').select('profile_id, taken_at').in('profile_id', ids)

      const lastTakenByProfile = {}
      ;(attemptRows ?? []).forEach((a) => {
        if (!lastTakenByProfile[a.profile_id] || a.taken_at > lastTakenByProfile[a.profile_id]) {
          lastTakenByProfile[a.profile_id] = a.taken_at
        }
      })

      const now = new Date()
      quizReminders = staffRows
        .map((s) => {
          const lastTaken = lastTakenByProfile[s.id]
          const baseline = lastTaken ?? s.hire_date ?? s.created_at
          if (!baseline) return null
          const dueDate = addMonths(new Date(baseline), reminderMonths)
          if (dueDate > now) return null
          const name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || 'This staff member'
          return {
            id: `quiz-reminder-${s.id}`,
            type: 'quiz_reminder',
            date: dueDate,
            title: profile.id === s.id ? 'Time to retake the quiz' : `${name} is overdue for the quiz`,
            subtitle: lastTaken ? `Last taken ${new Date(lastTaken).toLocaleDateString()}` : 'No quiz attempt on record yet',
            raw: s,
          }
        })
        .filter(Boolean)
    }

    // Jeff, 2026-09: "未qualified的員工在工作超過50個小時後会開始在bulletin
    // 裡跳出提示...每增加10小時会跳出一個提示,超過100小時候每超過10小時也
    // 會有提示" — same computed-not-stored approach as the quiz reminders
    // above: recomputed fresh from current hours worked every time this
    // loads, so it naturally "updates" itself every time a new 10-hour band
    // is crossed without needing to track which bands were already shown.
    // Population mirrors Learning Tracker's own staff list (LearningTrackerPage.jsx) rather
    // than the narrower role==='staff' scope quiz reminders use above —
    // this is specifically about Learning Tracker's qualified tracking, so
    // it should cover exactly who Learning Tracker itself tracks.
    let trainingHourStaff = []
    if (isManagerOrAdmin) {
      const { data } = await supabase
        .from('user_stores')
        .select('profiles(id, first_name, last_name, role, qualified, is_active, primary_store_id, join_store_activity)')
        .eq('store_id', currentStoreId)
      const byId = new Map()
      ;(data ?? []).forEach((m) => {
        const p = m.profiles
        // Join store activity unchecked at this (additional) store —
        // migration 0064 — matches the same exclusion Learning Tracker's
        // own staff list applies (see comment above this block).
        if (p && p.is_active && !p.qualified && !NON_PICKABLE_STAFF_ROLES.includes(p.role) && isActiveStoreMember(p, currentStoreId)) {
          byId.set(p.id, p)
        }
      })
      trainingHourStaff = Array.from(byId.values())
    } else if (profile && !profile.qualified && !NON_PICKABLE_STAFF_ROLES.includes(profile.role)) {
      trainingHourStaff = [profile]
    }

    let trainingHourReminders = []
    if (trainingHourStaff.length) {
      const minutesByProfile = await getWorkedMinutesByProfile(trainingHourStaff.map((s) => s.id))
      trainingHourReminders = trainingHourStaff
        .map((s) => {
          const hours = (minutesByProfile[s.id] ?? 0) / 60
          const band = Math.floor(hours / 10) * 10
          if (band < TRAINING_REMINDER_START_HOURS) return null
          const isSelf = profile.id === s.id
          const name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || 'This staff member'
          const overHours = band - TRAINING_TARGET_HOURS
          let title
          if (band < TRAINING_TARGET_HOURS) {
            const remaining = TRAINING_TARGET_HOURS - band
            title = isSelf
              ? `${remaining} hours left until your Formal Quiz`
              : `${name}: ${remaining} hours left until Formal Quiz`
          } else if (overHours <= 0) {
            title = isSelf
              ? 'Reached 100 hours of training — take the Formal Quiz as soon as possible'
              : `${name} reached 100 hours of training — Formal Quiz due`
          } else {
            title = isSelf
              ? `${overHours} hours over standard training — take the Formal Quiz as soon as possible`
              : `${name} is ${overHours} hours over standard training — Formal Quiz overdue`
          }
          return {
            id: `training-hours-${s.id}`,
            type: 'training_hours',
            // Always "now", not a fixed date — like the quiz reminders
            // above, this describes CURRENT status rather than a one-off
            // posting, so it should always sort to the top of the feed as
            // long as it's still relevant, not fade backward over time.
            date: new Date(),
            title,
            subtitle: `${hours.toFixed(1)}h worked so far`,
            raw: s,
          }
        })
        .filter(Boolean)
    }

    // This person's own "last opened THIS announcement" timestamp
    // (migration 0056), by announcement id — read once, reused for both
    // announcements and customer complaints below (they're the same table).
    const announcementReadAt = new Map((announcementReadRows ?? []).map((r) => [r.announcement_id, r.read_at]))
    // Never opened at all → "New". Opened before, but edited again since →
    // "Update". Both clear the same way: actually opening it (see openItem
    // below) upserts announcement_reads and clears the flag locally.
    function readFlags(a) {
      const readAt = announcementReadAt.get(a.id)
      return { isNewItem: !readAt, hasUpdate: !!readAt && readAt < a.updated_at }
    }

    // Merge the month-filtered rows with the unfiltered important ones,
    // deduped by id (an important announcement updated within the last
    // month would otherwise appear in both queries).
    const mergedAnnouncementRows = Array.from(
      new Map([...(announcementRows ?? []), ...(importantAnnouncementRows ?? [])].map((a) => [a.id, a])).values()
    )

    const announcementItems = mergedAnnouncementRows.map((a) => {
      // Prefer the permanent name snapshot over the live creator/editor
      // join, which goes blank once that person's account is removed.
      const actor = a.editor ?? a.creator
      const actorName = a.updated_by_name || a.created_by_name || (actor ? `${actor.first_name ?? ''} ${actor.last_name ?? ''}`.trim() : '')
      return {
        id: `announcement-${a.id}`,
        type: 'announcement',
        date: new Date(a.updated_at),
        title: a.title,
        subtitle: `${new Date(a.updated_at).toLocaleString()}${actorName ? ` · ${actorName}` : ''}`,
        isImportant: a.is_important,
        ...readFlags(a),
        raw: a,
      }
    })

    const complaintItems = (complaintRows ?? []).map((a) => {
      const actor = a.editor ?? a.creator
      const actorName = a.updated_by_name || a.created_by_name || (actor ? `${actor.first_name ?? ''} ${actor.last_name ?? ''}`.trim() : '')
      const solvedNote = a.solved
        ? ` · ✓ Solved ${new Date(a.solved_at).toLocaleDateString()}${a.solved_by_name ? ` by ${a.solved_by_name}` : ''}`
        : ''
      return {
        id: `announcement-${a.id}`,
        type: 'customer_complaint',
        date: new Date(a.updated_at),
        title: a.title,
        subtitle: `${new Date(a.updated_at).toLocaleString()}${actorName ? ` · ${actorName}` : ''}${solvedNote}`,
        isImportant: a.is_important,
        solved: a.solved,
        ...readFlags(a),
        raw: a,
      }
    })

    // Latest change_events timestamp per roster_period_id — a period with
    // no rows at all just means nobody's shift on it changed since it was
    // first published (a brand-new period counts as "changed" too, via the
    // insert in ManageRosterPage's doPersist, so this covers both cases the
    // same way). Seeded with '' rather than null/undefined: `changed_at` is
    // always a string, and comparing a string to null/undefined with `>`
    // coerces both sides to Number (the string becomes NaN), so that
    // comparison is always false — see AuthContext.jsx's refreshRosterUpdates
    // for the same bug, already fixed there the same way.
    const periodLatestChange = new Map()
    ;(changeEventRows ?? []).forEach((r) => {
      const cur = periodLatestChange.get(r.roster_period_id) ?? ''
      if (r.changed_at > cur) periodLatestChange.set(r.roster_period_id, r.changed_at)
    })
    // This person's own "last opened THIS specific week" timestamp, per
    // roster_period_id (migration 0048) — unlike the old single per-store
    // bulletin_roster_viewed_at, switching to the Roster tab never touches
    // this; only actually opening that week's roster (see openItem below)
    // does, so a still-unopened week keeps its badge even after the tab's
    // been visited.
    const periodViewedAt = new Map((periodViewRows ?? []).map((r) => [r.roster_period_id, r.viewed_at]))

    const rosterItems = (rosterRows ?? []).map((r) => {
      const creatorName = r.created_by_name || (r.creator ? `${r.creator.first_name ?? ''} ${r.creator.last_name ?? ''}`.trim() : '')
      const latestChange = periodLatestChange.get(r.id)
      const viewedAt = periodViewedAt.get(r.id)
      return {
        id: `roster-${r.id}`,
        type: 'roster',
        date: new Date(r.submitted_at),
        title: `Roster posted: ${r.week_start_date} – ${r.week_end_date}`,
        subtitle: `${new Date(r.submitted_at).toLocaleString()}${creatorName ? ` · ${creatorName}` : ''}`,
        // This specific week's own "Update" badge — see the comment above.
        hasUpdate: !!latestChange && (!viewedAt || latestChange > viewedAt),
        raw: r,
      }
    })

    const merged = [...announcementItems, ...complaintItems, ...rosterItems, ...quizReminders, ...trainingHourReminders].sort(
      (a, b) => b.date - a.date
    )
    setItems(merged)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [currentStoreId, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => (filter ? items.filter((i) => i.type === filter) : items), [items, filter])
  // The Roster tab's small dot (see below) stays lit as long as ANY roster
  // row in the (unfiltered) list still has an unopened update — switching
  // filters never affects this, only actually opening a week does (openItem
  // below), so it only goes out once every week's been opened.
  const hasUnviewedRoster = useMemo(() => items.some((i) => i.type === 'roster' && i.hasUpdate), [items])
  // Same small-dot treatment for the other two tabs (migration 0056) —
  // "unviewed" covers both a never-opened item (isNewItem) and one that's
  // been edited again since this person last opened it (hasUpdate).
  const hasUnviewedAnnouncement = useMemo(
    () => items.some((i) => i.type === 'announcement' && (i.isNewItem || i.hasUpdate)),
    [items]
  )
  const hasUnviewedComplaint = useMemo(
    () => items.some((i) => i.type === 'customer_complaint' && (i.isNewItem || i.hasUpdate)),
    [items]
  )

  function toggleFilter(key) {
    setFilter((prev) => (prev === key ? null : key))
  }

  function openItem(item) {
    if (item.type === 'announcement' || item.type === 'customer_complaint') {
      // Unlike the Roster branch below, the read receipt itself is written
      // by AnnouncementDetailModal (migration 0056) the moment it loads an
      // existing item — not here — so it's covered no matter how the modal
      // was opened (this list, or the separate "⭐ Important Announcements"
      // picker). This list's own New/Update flags just get refreshed by the
      // full reload on close (see onClose below) rather than an optimistic
      // local patch.
      setOpenAnnouncementId(item.raw.id)
    } else if (item.type === 'roster') {
      setOpenRosterPeriod(item.raw)
      // Opening THIS specific week is "having looked at it" — clears its own
      // Update badge (migration 0048), independent of every other week's.
      // Other people's own copies of this same week's badge are unaffected;
      // this is deliberately per-person, not "everyone who opens the tab".
      if (item.hasUpdate && profile?.id) {
        supabase
          .from('roster_period_views')
          .upsert({ profile_id: profile.id, roster_period_id: item.raw.id, viewed_at: new Date().toISOString() }, { onConflict: 'profile_id,roster_period_id' })
          .then(() => {
            setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, hasUpdate: false } : i)))
            // Clears the Sidebar's Bulletin dot too, if this was the last
            // unviewed thing — see AuthContext.jsx's hasBulletinUpdates.
            refreshBulletinUpdates?.()
          })
      }
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => toggleFilter(f.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                filter === f.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
              }`}
            >
              {f.label}
              {/* A light "something in here is still unopened" hint at the
                  tab level — the detail lives on each affected Roster row
                  itself (see below), so this stays a small raised dot
                  rather than repeating an "Update" pill here too. Stays lit
                  until every week in the list has actually been opened. */}
              {f.key === 'roster' && hasUnviewedRoster && (
                <span className="-translate-y-1.5 h-1.5 w-1.5 rounded-full bg-red-500" aria-label="Update" />
              )}
              {f.key === 'announcement' && hasUnviewedAnnouncement && (
                <span className="-translate-y-1.5 h-1.5 w-1.5 rounded-full bg-red-500" aria-label="Update" />
              )}
              {f.key === 'customer_complaint' && hasUnviewedComplaint && (
                <span className="-translate-y-1.5 h-1.5 w-1.5 rounded-full bg-red-500" aria-label="Update" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowImportant(true)}>
            ⭐ Important Announcements
          </Button>
          {canPost && <Button onClick={() => setOpenAnnouncementId('new')}>+ New Announcement</Button>}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !visible.length ? (
        <EmptyState label="Nothing to show." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {visible.map((item) => {
            const badge = TYPE_BADGE[item.type]
            const clickable = item.type !== 'quiz_reminder' && item.type !== 'training_hours'
            const Wrapper = clickable ? 'button' : 'div'
            return (
              <Wrapper
                key={item.id}
                onClick={clickable ? () => openItem(item) : undefined}
                className={`flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between ${
                  clickable ? 'hover:bg-brand-50' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge color={badge.color}>{badge.label}</Badge>
                  {item.isImportant && <Badge color="red">Important</Badge>}
                  <span className="font-medium text-gray-800">{item.title}</span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Status/notification badges sit here, immediately left of
                      the date/editor text, instead of crowding the category
                      tag + title on the left — same slot for both: which
                      week's roster just changed, and whether a complaint's
                      been solved. */}
                  {item.type === 'roster' && item.hasUpdate && <Badge color="red">Update</Badge>}
                  {(item.type === 'announcement' || item.type === 'customer_complaint') && item.isNewItem && (
                    <Badge color="red">New</Badge>
                  )}
                  {(item.type === 'announcement' || item.type === 'customer_complaint') && item.hasUpdate && (
                    <Badge color="red">Update</Badge>
                  )}
                  {item.type === 'customer_complaint' &&
                    (item.solved ? <Badge color="green">Solved</Badge> : <Badge color="gray">Unsolved</Badge>)}
                  <span className="shrink-0 text-xs text-gray-400">{item.subtitle}</span>
                  {(item.type === 'quiz_reminder' || item.type === 'training_hours') && (
                    <Link
                      to="/dashboard/study-log"
                      className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
                    >
                      Take Quiz
                    </Link>
                  )}
                </div>
              </Wrapper>
            )
          })}
        </div>
      )}

      {openAnnouncementId && (
        <AnnouncementDetailModal
          announcementId={openAnnouncementId === 'new' ? null : openAnnouncementId}
          storeId={currentStoreId}
          onClose={() => {
            setOpenAnnouncementId(null)
            // Just viewing (no save) can still have cleared this item's own
            // New/Update flag — the modal marks it read as soon as it loads
            // an existing item (migration 0056) — so refresh to pick that up,
            // same as the onSaved reload just below already does for edits.
            load()
            refreshBulletinUpdates?.()
          }}
          onSaved={() => {
            setOpenAnnouncementId(null)
            load()
            refreshBulletinUpdates?.()
          }}
        />
      )}
      {showImportant && (
        <ImportantAnnouncementsModal
          storeId={currentStoreId}
          onClose={() => setShowImportant(false)}
          onSelect={(id) => {
            setShowImportant(false)
            setOpenAnnouncementId(id)
          }}
        />
      )}
      {openRosterPeriod && (
        <Modal
          open
          onClose={() => setOpenRosterPeriod(null)}
          extraWide
          title={`Roster: ${openRosterPeriod.week_start_date} – ${openRosterPeriod.week_end_date}`}
        >
          <RosterWeekTable period={openRosterPeriod} />
        </Modal>
      )}
    </div>
  )
}
