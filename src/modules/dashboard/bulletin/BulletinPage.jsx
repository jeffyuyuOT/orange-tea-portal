import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addMonths } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import AnnouncementDetailModal from './AnnouncementDetailModal'
import ImportantAnnouncementsModal from './ImportantAnnouncementsModal'
import RosterWeekTable from '../../roster-hub/shared/RosterWeekTable'

// Toggle filters shown to the user. There's no third button for quiz
// reminders — those only ever appear in the unfiltered "all" view, same as
// any future message type that isn't roster/announcement.
const FILTERS = [
  { key: 'roster', label: 'Roster' },
  { key: 'announcement', label: 'Store Announcement' },
]

const TYPE_BADGE = {
  announcement: { label: 'Announcement', color: 'brand' },
  roster: { label: 'Roster', color: 'green' },
  quiz_reminder: { label: 'Quiz Reminder', color: 'red' },
}

// Unified Bulletin Board feed: merges store announcements, newly-submitted
// rosters, and (computed, not stored) quiz-attendance reminders into one
// newest-first list. Announcements and rosters drop out of the feed once
// they're more than a month old; quiz reminders instead stay until the
// person actually takes the quiz, since they describe current status, not a
// one-off posting.
export default function BulletinPage() {
  const { currentStoreId, profile } = useAuth()
  const [filter, setFilter] = useState(null) // null = all, or 'roster' | 'announcement'
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [openAnnouncementId, setOpenAnnouncementId] = useState(null) // null closed, 'new', or uuid
  const [openRosterPeriod, setOpenRosterPeriod] = useState(null)
  const [showImportant, setShowImportant] = useState(false)

  const isManagerOrAdmin = profile?.role === 'admin' || profile?.role === 'shop_manager'
  const canPost = isManagerOrAdmin

  async function load() {
    if (!currentStoreId || !profile) return
    setLoading(true)

    const oneMonthAgo = addMonths(new Date(), -1).toISOString()

    const [{ data: announcementRows }, { data: rosterRows }, { data: settingsRow }] = await Promise.all([
      supabase
        .from('announcements')
        .select('*, creator:created_by(first_name,last_name), editor:updated_by(first_name,last_name)')
        .eq('store_id', currentStoreId)
        .gte('updated_at', oneMonthAgo)
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

    const announcementItems = (announcementRows ?? []).map((a) => {
      const actor = a.editor ?? a.creator
      const actorName = actor ? `${actor.first_name ?? ''} ${actor.last_name ?? ''}`.trim() : ''
      return {
        id: `announcement-${a.id}`,
        type: 'announcement',
        date: new Date(a.updated_at),
        title: a.title,
        subtitle: `${new Date(a.updated_at).toLocaleString()}${actorName ? ` · ${actorName}` : ''}`,
        isImportant: a.is_important,
        raw: a,
      }
    })

    const rosterItems = (rosterRows ?? []).map((r) => {
      const creatorName = r.creator ? `${r.creator.first_name ?? ''} ${r.creator.last_name ?? ''}`.trim() : ''
      return {
        id: `roster-${r.id}`,
        type: 'roster',
        date: new Date(r.submitted_at),
        title: `Roster posted: ${r.week_start_date} – ${r.week_end_date}`,
        subtitle: `${new Date(r.submitted_at).toLocaleString()}${creatorName ? ` · ${creatorName}` : ''}`,
        raw: r,
      }
    })

    const merged = [...announcementItems, ...rosterItems, ...quizReminders].sort((a, b) => b.date - a.date)
    setItems(merged)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [currentStoreId, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => (filter ? items.filter((i) => i.type === filter) : items), [items, filter])

  function toggleFilter(key) {
    setFilter((prev) => (prev === key ? null : key))
  }

  function openItem(item) {
    if (item.type === 'announcement') setOpenAnnouncementId(item.raw.id)
    else if (item.type === 'roster') setOpenRosterPeriod(item.raw)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => toggleFilter(f.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                filter === f.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
              }`}
            >
              {f.label}
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
            const clickable = item.type !== 'quiz_reminder'
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
                  <span className="shrink-0 text-xs text-gray-400">{item.subtitle}</span>
                  {item.type === 'quiz_reminder' && (
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
          onClose={() => setOpenAnnouncementId(null)}
          onSaved={() => {
            setOpenAnnouncementId(null)
            load()
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
          wide
          title={`Roster: ${openRosterPeriod.week_start_date} – ${openRosterPeriod.week_end_date}`}
        >
          <RosterWeekTable period={openRosterPeriod} />
        </Modal>
      )}
    </div>
  )
}
