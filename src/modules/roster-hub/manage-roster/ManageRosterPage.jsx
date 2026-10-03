import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import RosterEntryGrid from './RosterEntryGrid'
import UnderstaffedWarnings, { computeUnderstaffedWarnings } from './UnderstaffedWarnings'
import ImportReconcileModal from './ImportReconcileModal'
import StaffAvailabilityModal from './StaffAvailabilityModal'
import {
  downloadRosterTemplate,
  parseRosterGrid,
  decimalToTime,
  timeToDecimal,
  rosterDisplayName,
  buildReconcilePlan,
  pendingAsStaff,
  pendingRosterName,
} from '../../../lib/excelRoster'
import { NON_ROSTER_STAFF_ROLES } from '../../../lib/permissions'
import { loadWeekAvailabilityForProfiles } from '../../../lib/availability'
import { isActiveStoreMember } from '../../../lib/storeVisibility'
import { thisWeekStart } from '../shared/rosterWeeks'

export default function ManageRosterPage() {
  const { currentStoreId, accessibleStores, profile, refreshRosterUpdates, refreshBulletinUpdates } = useAuth()
  const location = useLocation()
  const [weekStart, setWeekStart] = useState('')
  const [entries, setEntries] = useState([])
  const [notes, setNotes] = useState('')
  const [staff, setStaff] = useState([])
  const [pendingStaff, setPendingStaff] = useState([])
  const [rules, setRules] = useState([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  // Set whenever the grid (from typing, "+ Add row", or an Excel upload)
  // has a name that doesn't match anyone known for this store even after
  // typo-tolerant matching — see handleUpload/persist/buildReconcilePlan.
  // `saveStatus` is set when this review was triggered by Save/Submit
  // (rather than by an upload), so confirming it also completes that save.
  const [importReview, setImportReview] = useState(null)
  // Jeff, 2026-10-01: "understaffed slots平常不顯示，在按Save和Submit才跳出
  // 視窗提示，但還是可以繼續儲存跟發布" — { status, warnings } while the
  // confirm popup is up (status is whichever of 'draft'/'submitted' Save/
  // Submit was clicked with), null otherwise. Set by handleSaveOrSubmit
  // below instead of persist() running immediately — a soft warning the
  // manager can look at and still choose to save/publish past, not a block.
  const [understaffedConfirm, setUnderstaffedConfirm] = useState(null)
  // Jeff, 2026-10-01: "action裡新增clear, 如果按clear消除表格載入的資料，給
  // 有時候存好草稿(save not publish)但要清除資料時重做班表用。但已發布的班
  // 表如果清除並發布的話會跳出警示視窗確認" — `loadedPeriodStatus` tracks
  // whichever roster_periods row is currently loaded for this week ('draft'/
  // 'submitted'/null for "nothing saved yet"), refreshed by the week-loading
  // effect below every time the week or store changes. `clearedFromPublished`
  // only turns true when Clear is used while that loaded period was already
  // 'submitted' (published) — Jeff's "已發布的班表...清除" case specifically,
  // not a draft being cleared and redone, which needs no extra warning at
  // all. `clearPublishConfirm` is the { status } for that one special
  // confirm popup, separate from the ordinary understaffedConfirm below
  // since it's about a different risk (wiping a LIVE published roster, not
  // staffing levels) and can apply even when staffing itself looks fine.
  const [loadedPeriodStatus, setLoadedPeriodStatus] = useState(null)
  const [clearedFromPublished, setClearedFromPublished] = useState(false)
  const [clearPublishConfirm, setClearPublishConfirm] = useState(null)
  // Jeff, 2026-10-03: "已經publish的班表，只能用publish蓋過，不能用save(not
  // publish讓它變成not publish)...按save (not publish)，要跳出警示視窗說此班
  // 表已經發布，只能用publish去更改" — once a week is live (loadedPeriodStatus
  // 'submitted'), Save (not published) is blocked outright, not just soft-
  // warned: persist(status) always upserts roster_periods.status to whatever
  // was clicked (see persist() below), so a plain Save on a published week
  // would silently demote it back to an unpublished draft — this is a true
  // block (an info popup with nothing to click past), unlike the understaffed
  // warning above or the Clear-then-Submit confirm below, both of which are
  // fine to save/publish through once acknowledged.
  const [publishedDraftBlocked, setPublishedDraftBlocked] = useState(false)
  // Download template / Upload Excel / Export current grid used to be three
  // separate buttons crowding the toolbar — merged into one "Action"
  // dropdown at the right of the row (see the render below). `fileInputRef`
  // lets the "Upload Excel" menu item open the same hidden file picker the
  // old standalone button/label used to trigger just by being a <label>.
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const actionMenuRef = useRef(null)
  const fileInputRef = useRef(null)
  // "View Staff's Availability" — read-only, sits beside the Action
  // dropdown rather than inside it since it's a lookup, not a
  // destructive/file operation the way the other three menu items are.
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false)
  // Jeff, 2026-10-02: "上面的那一段說明改到instruction小圖示放在submit那一
  // 行的最右邊，點擊圖示在跳出視窗顯示這一段說明" — the "Fill in the grid
  // below..." paragraph that used to sit permanently under the page title
  // (taking up vertical space on every visit, mobile especially) is now
  // only shown on demand, via this ℹ️ icon at the end of the Save/Submit
  // toolbar.
  const [showInstructions, setShowInstructions] = useState(false)
  // Feeds RosterEntryGrid's soft "outside declared availability" warning
  // (task 29) — refetched whenever the staff list or the week being edited
  // changes, so the check is always against the right week's declarations.
  const [availabilityByProfile, setAvailabilityByProfile] = useState({})

  useEffect(() => {
    if (!actionMenuOpen) return
    function handleOutsideClick(e) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) setActionMenuOpen(false)
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [actionMenuOpen])

  // Staff/Pending-staff removed from THIS store's roster altogether — a ✕
  // next to their name (RosterEntryGrid's `removeRow`) now persists
  // `hidden_from_roster` on their user_stores/roster_pending_staff row
  // (migration 0059_roster_staff_order_and_hide.sql) instead of only
  // hiding them for the currently-open week in local state — a manager
  // restores them (and adds them back into the ordering list) from
  // Roster Hub > Setting > Roster Staff Order, not from here.
  async function persistHideStaff(row) {
    if (row.profileId) {
      await supabase.from('user_stores').update({ hidden_from_roster: true }).match({ profile_id: row.profileId, store_id: currentStoreId })
      setStaff((prev) => prev.filter((s) => s.id !== row.profileId))
    } else if (row.pendingId) {
      await supabase.from('roster_pending_staff').update({ hidden_from_roster: true }).eq('id', row.pendingId)
      setPendingStaff((prev) => prev.filter((p) => p.id !== row.pendingId))
    }
  }

  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? ''

  // Jeff, 2026-10-01: "點擊到manage roster頁面預設載入這禮拜頁面(之前好像是
  // 上次排完的班表的下個禮拜，所以之前的邏輯要改掉)" -- always land on the
  // CURRENT calendar week (today's Monday-start week) instead of whichever
  // week happened to follow this store's most recently saved period (that
  // used to mean the page defaulted further and further into the future the
  // more weeks got scheduled ahead). Reaching a week further out — either
  // direction — is purely the "Week starting" date picker's job now, with
  // the Action dropdown's Last/Current/Next week items below covering the
  // common one-week-away cases.
  useEffect(() => {
    if (!currentStoreId) return
    setWeekStart(thisWeekStart())
    // Who's "on" this store's roster — read from user_stores rather than
    // profiles.primary_store_id directly, so an admin (or manager) only
    // shows up in the store(s) they're actually assigned to in User
    // Management, instead of every store just because of their role. See
    // migration 0027's comment: user_stores is backfilled from
    // primary_store_id, so this covers everyone who was already showing up
    // the old way too.
    supabase
      .from('user_stores')
      // roster_display_name lives on user_stores (per store, not on
      // profiles) — someone working at more than one store can be shown
      // under a different name at each, set from that store's Staff
      // Information. Folded back onto the embedded profile below so
      // rosterDisplayName() just reads `.roster_display_name` either way.
      // roster_order/hidden_from_roster (migration
      // 0059_roster_staff_order_and_hide.sql) are Roster Hub > Setting >
      // Roster Staff Order's doing — a ✕ in this grid sets
      // hidden_from_roster (see persistHideStaff above), so someone hidden
      // that way is excluded here entirely rather than only for one week.
      // qualified (profiles.qualified, migration 0049_staff_qualified.sql)
      // is what RosterEntryGrid uses to show a not-yet-Qualified staff
      // member's name/shift time in red. training_journey_phase/
      // has_master_title (Training Journey spec, point 6) are the same
      // idea's successor — RosterEntryGrid reads them instead, under
      // whichever Roster Name Display Format System Setting has chosen.
      // has_expert_title (Expert/Master split, point 4) joins them so
      // rosterTitleStyle() can tell Expert apart from Master/in-progress.
      .select(
        'roster_display_name, roster_order, hidden_from_roster, profiles(id, first_name, last_name, email, is_active, role, qualified, primary_store_id, join_store_activity, training_journey_phase, has_expert_title, has_master_title)'
      )
      .eq('store_id', currentStoreId)
      .order('roster_order')
      .then(({ data }) => {
        // training/qr_code_maker accounts don't get scheduled at all (per
        // Jeff — they don't work store shifts), so they never auto-populate
        // onto this grid the way real staff do. developer is deliberately
        // NOT in this list (see NON_ROSTER_STAFF_ROLES) — it can be
        // scheduled like any other role once assigned to a store. Someone
        // whose "also belong to" membership at this store has Join store
        // activity unchecked (isActiveStoreMember, migration 0064) can
        // still view this store, but doesn't get auto-populated onto its
        // roster grid.
        const list = (data ?? [])
          .filter(
            (r) =>
              r.profiles?.is_active &&
              !NON_ROSTER_STAFF_ROLES.includes(r.profiles.role) &&
              !r.hidden_from_roster &&
              isActiveStoreMember(r.profiles, currentStoreId)
          )
          .map((r) => ({ ...r.profiles, roster_display_name: r.roster_display_name, roster_order: r.roster_order }))
        setStaff(list)
      })
    supabase
      .from('roster_pending_staff')
      .select('*')
      .eq('store_id', currentStoreId)
      .eq('hidden_from_roster', false)
      .order('roster_order')
      .then(({ data }) => setPendingStaff(data ?? []))
    supabase
      .from('roster_staffing_rules')
      .select('*')
      .eq('store_id', currentStoreId)
      .then(({ data }) => setRules(data ?? []))
  }, [currentStoreId])

  // "Load" a period passed via History page navigation state.
  useEffect(() => {
    const loadPeriodId = location.state?.loadPeriodId
    if (!loadPeriodId) return
    ;(async () => {
      const { data: period } = await supabase.from('roster_periods').select('*').eq('id', loadPeriodId).single()
      // roster_display_name is per-store — fetch it for THIS period's
      // store separately rather than embedding it off profiles.
      const [{ data: rows }, { data: nameRows }] = await Promise.all([
        supabase.from('roster_entries').select('*, profiles(first_name, last_name)').eq('roster_period_id', loadPeriodId),
        supabase.from('user_stores').select('profile_id, roster_display_name').eq('store_id', period?.store_id ?? ''),
      ])
      const nameByProfile = new Map((nameRows ?? []).map((r) => [r.profile_id, r.roster_display_name]))
      if (period) {
        setWeekStart(period.week_start_date)
        setNotes(period.notes ?? '')
      }
      setEntries(
        (rows ?? []).map((r) => ({
          profileId: r.profile_id ?? '',
          staffName: r.profiles
            ? rosterDisplayName({ ...r.profiles, roster_display_name: nameByProfile.get(r.profile_id) })
            : r.staff_name_raw ?? '',
          date: r.work_date,
          startTime: timeToDecimal(r.start_time),
          endTime: timeToDecimal(r.end_time),
          breakHours: r.break_half_hours ?? '',
          notes: r.notes ?? '',
        }))
      )
    })()
  }, [location.state])

  // Jeff, 2026-10-01: "進入manage roster頁面預設是載入這禮拜的班表，所以要有
  // 這禮拜班表的資料" — the effect above already lands on the right WEEK
  // (thisWeekStart()), but nothing was actually fetching that week's
  // already-saved roster_periods/roster_entries — `entries` only ever got
  // populated from the database via the loadPeriodId effect above (History
  // page navigation). Opening Manage Roster directly always showed a blank
  // grid, even for a week that already had a saved (draft or published)
  // roster, because nothing queried for it. This fires whenever the week or
  // store being edited changes — by landing on the default week, picking a
  // new Week starting date, or an Action dropdown Last/Current/Next week
  // jump — and loads that week's existing roster_periods row (if any) the
  // same way the loadPeriodId effect above does; no existing period for
  // that week yet (a week nobody's touched) just clears the grid to blank,
  // same as it already did.
  useEffect(() => {
    if (!weekStart || !currentStoreId) return
    let cancelled = false
    // Loading a (possibly different) week starts the Clear-while-published
    // tracking fresh — whatever was cleared before belongs to the PREVIOUS
    // week being edited, not this one.
    setClearedFromPublished(false)
    ;(async () => {
      const { data: period } = await supabase
        .from('roster_periods')
        .select('*')
        .eq('store_id', currentStoreId)
        .eq('week_start_date', weekStart)
        .maybeSingle()
      if (cancelled) return
      setLoadedPeriodStatus(period?.status ?? null)
      if (!period) {
        setEntries([])
        setNotes('')
        return
      }
      setNotes(period.notes ?? '')
      const [{ data: rows }, { data: nameRows }] = await Promise.all([
        supabase.from('roster_entries').select('*, profiles(first_name, last_name)').eq('roster_period_id', period.id),
        supabase.from('user_stores').select('profile_id, roster_display_name').eq('store_id', currentStoreId),
      ])
      if (cancelled) return
      const nameByProfile = new Map((nameRows ?? []).map((r) => [r.profile_id, r.roster_display_name]))
      setEntries(
        (rows ?? []).map((r) => ({
          profileId: r.profile_id ?? '',
          staffName: r.profiles
            ? rosterDisplayName({ ...r.profiles, roster_display_name: nameByProfile.get(r.profile_id) })
            : r.staff_name_raw ?? '',
          date: r.work_date,
          startTime: timeToDecimal(r.start_time),
          endTime: timeToDecimal(r.end_time),
          breakHours: r.break_half_hours ?? '',
          notes: r.notes ?? '',
        }))
      )
    })()
    return () => {
      cancelled = true
    }
  }, [weekStart, currentStoreId])

  useEffect(() => {
    if (!weekStart || !staff.length) {
      setAvailabilityByProfile({})
      return
    }
    let cancelled = false
    loadWeekAvailabilityForProfiles(
      staff.map((s) => s.id),
      weekStart
    ).then((result) => {
      if (!cancelled) setAvailabilityByProfile(result)
    })
    return () => {
      cancelled = true
    }
  }, [weekStart, staff])

  const weekDates = weekStart ? Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd')) : []
  // Pending staff show up in the downloadable template and "current grid"
  // export too, same as on-screen, so a not-yet-formal hire can be
  // scheduled ahead of time whichever way the roster gets filled in.
  // Sorted by roster_order (Roster Hub > Setting > Roster Staff Order) so
  // the template/export lists people in the same order the on-screen grid
  // does (RosterEntryGrid does its own equivalent merge of `staff` +
  // `pendingStaff`) rather than always putting every Pending person after
  // every real staff member regardless of the order set there.
  const templateStaff = [...staff, ...pendingAsStaff(pendingStaff)].sort((a, b) => (a.roster_order ?? 0) - (b.roster_order ?? 0))

  function knownNames() {
    return [
      ...staff.map((s) => ({ type: 'staff', id: s.id, name: rosterDisplayName(s) })),
      ...pendingStaff.map((p) => ({ type: 'pending', id: p.id, name: pendingRosterName(p) })),
    ]
  }

  // Applies a resolved plan (each item's `match` says who a raw name really
  // is) onto the parsed entries — shared by the no-review-needed path and
  // by confirmImport once the manager has answered for the 'new' ones.
  function applyPlan(parsed, plan) {
    const byRaw = Object.fromEntries(plan.filter((p) => p.match).map((p) => [p.rawName, p.match]))
    return parsed.map((e) => {
      if (e.profileId || !e.staffName) return e
      const m = byRaw[e.staffName]
      if (!m) return e
      return m.type === 'staff' ? { ...e, profileId: m.id, staffName: m.name } : { ...e, profileId: '', staffName: m.name }
    })
  }

  // Finds every name in `list` that isn't tied to a profile yet and isn't
  // already an exact/typo match for someone known — i.e. genuinely needs a
  // manager's confirmation before it's treated as a real person. Shared by
  // the upload path and the save path below, since both need the same
  // "is this actually a new person" check.
  function findsNeedingReview(list) {
    const rawNames = Array.from(new Set(list.filter((e) => !e.profileId && e.staffName).map((e) => e.staffName)))
    if (!rawNames.length) return null
    const known = knownNames()
    const plan = buildReconcilePlan(rawNames, known)
    const needsReview = plan.filter((p) => p.status === 'new')
    return { plan, known, needsReview }
  }

  async function handleUpload(file) {
    let parsed
    try {
      // storeName picks which tab gets read when the uploaded file has more
      // than one sheet (e.g. the admin's one-sheet-per-store export) — see
      // findStoreSheet in excelRoster.js. A single-sheet file is always
      // accepted regardless of its tab's name.
      parsed = await parseRosterGrid(file, staff, weekDates, storeName)
    } catch (err) {
      alert(err.message)
      return
    }
    // parseRosterGrid only matches against active staff — anything left
    // with no profileId either fuzzy-matches an existing name (typo,
    // auto-applied) or needs the manager to confirm it's genuinely new.
    const found = findsNeedingReview(parsed)
    if (!found) {
      setEntries(parsed)
      return
    }
    if (!found.needsReview.length) {
      setEntries(applyPlan(parsed, found.plan))
      return
    }
    setImportReview({ parsed, plan: found.plan, known: found.known })
  }

  // Confirms whichever names Save/Submit or an upload flagged as needing
  // review — inserts the ones confirmed as new into Pending staff, remaps
  // the rest to their chosen match, and (only when this review was
  // triggered by Save/Submit — see `saveStatus`) completes that save with
  // the now-resolved entries.
  async function confirmReview(choices) {
    const { parsed, plan, saveStatus } = importReview
    const known = knownNames()
    const newOnes = plan.filter((p) => p.status === 'new' && choices[p.rawName]?.mode === 'pending')
    let inserted = []
    if (newOnes.length) {
      const rows = newOnes.map((p) => ({ store_id: currentStoreId, display_name: (choices[p.rawName].name || p.rawName).trim() }))
      const { data } = await supabase.from('roster_pending_staff').insert(rows).select()
      inserted = data ?? []
    }
    let insertIdx = 0
    const resolvedPlan = plan.map((p) => {
      if (p.status !== 'new') return p
      const choice = choices[p.rawName]
      if (choice.mode === 'match') {
        const [type, id] = choice.matchKey.split(':')
        return { ...p, match: known.find((k) => k.type === type && k.id === id) ?? null }
      }
      const row = inserted[insertIdx++]
      return { ...p, match: row ? { type: 'pending', id: row.id, name: row.display_name } : null }
    })
    const finalEntries = applyPlan(parsed, resolvedPlan)
    setEntries(finalEntries)
    if (inserted.length) setPendingStaff((prev) => [...prev, ...inserted])
    setImportReview(null)
    if (saveStatus) await doPersist(saveStatus, finalEntries)
  }

  // The actual write — Save/Submit call this once there's nothing left
  // needing confirmation (either there never was, or confirmReview just
  // resolved it).
  async function doPersist(status, finalEntries) {
    setSaving(true)
    setMessage('')
    try {
      const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')
      // Upsert on (store_id, week_start_date) — Save/Submit used to insert a
      // fresh roster_periods row every click, so re-saving the same week
      // piled up near-duplicate drafts in History instead of updating the
      // one record for that week (see migration 0027).
      const { data: period, error } = await supabase
        .from('roster_periods')
        .upsert(
          {
            store_id: currentStoreId,
            week_start_date: weekStart,
            week_end_date: weekEnd,
            status,
            notes,
            created_by: profile.id,
            created_by_name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email,
            submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          },
          { onConflict: 'store_id,week_start_date' }
        )
        .select()
        .single()
      if (error) throw error

      // Snapshot whichever entries are there right now (empty for a
      // brand-new period) so we can tell, per staff member, whether their
      // own date/start/end/break actually changed once we overwrite this
      // below — used to raise the "Update" badge (migration 0047). Only
      // linked profiles matter here; an unmatched raw name has no account
      // to notify.
      const { data: prevRows } = await supabase
        .from('roster_entries')
        .select('profile_id, work_date, start_time, end_time, break_half_hours')
        .eq('roster_period_id', period.id)
        .not('profile_id', 'is', null)

      // Replace this period's entries wholesale rather than trying to
      // diff/upsert per row — the grid may have added or removed rows
      // since the last save.
      const { error: deleteError } = await supabase.from('roster_entries').delete().eq('roster_period_id', period.id)
      if (deleteError) throw deleteError

      const rows = finalEntries
        .filter((e) => e.date && e.startTime !== '' && e.endTime !== '')
        .map((e) => ({
          roster_period_id: period.id,
          profile_id: e.profileId || null,
          staff_name_raw: e.staffName,
          work_date: e.date,
          start_time: decimalToTime(e.startTime),
          end_time: decimalToTime(e.endTime),
          break_half_hours: e.breakHours === '' || e.breakHours == null ? null : e.breakHours,
          notes: e.notes || null,
        }))
      if (rows.length) {
        const { error: entriesError } = await supabase.from('roster_entries').insert(rows)
        if (entriesError) throw entriesError
      }

      // A publish (not a draft save — drafts aren't visible to staff at
      // all) that actually changed someone's own shift(s) logs a change
      // event for them, which is what makes their My Roster badge (and
      // everyone's Bulletin Roster tab badge) light up.
      if (status === 'submitted') {
        const sigOf = (r) => `${r.work_date}|${r.start_time}|${r.end_time}|${r.break_half_hours ?? ''}`
        const prevByKey = new Map((prevRows ?? []).map((r) => [`${r.profile_id}|${r.work_date}`, sigOf(r)]))
        const newRowsWithProfile = rows.filter((r) => r.profile_id)
        const newByKey = new Map(
          newRowsWithProfile.map((r) => [
            `${r.profile_id}|${r.work_date}`,
            sigOf({ work_date: r.work_date, start_time: r.start_time, end_time: r.end_time, break_half_hours: r.break_half_hours }),
          ])
        )
        const allKeys = new Set([...prevByKey.keys(), ...newByKey.keys()])
        const changedProfileIds = new Set()
        allKeys.forEach((key) => {
          if (prevByKey.get(key) !== newByKey.get(key)) changedProfileIds.add(key.split('|')[0])
        })
        if (changedProfileIds.size) {
          const { error: changeEventError } = await supabase.from('roster_change_events').insert(
            Array.from(changedProfileIds).map((profileId) => ({
              store_id: currentStoreId,
              profile_id: profileId,
              roster_period_id: period.id,
            }))
          )
          if (changeEventError) {
            // Don't fail the whole publish over the badge bookkeeping — the
            // roster itself already saved fine above.
            console.error('Failed to log roster_change_events:', changeEventError)
          } else {
            // AuthContext's rosterUpdates is otherwise only recomputed on
            // login/store-switch (or by My Roster/Bulletin right after they
            // mark themselves as viewed) — without this, a manager who is
            // also affected by their own change (or just stays on this page)
            // would never see the Sidebar badge light up until they reload
            // or log back in. This makes it show immediately in this tab.
            await refreshRosterUpdates()
            // Jeff (2026-09): hasBulletinUpdates (the Sidebar's Bulletin dot)
            // had the exact same gap — BulletinPage.jsx itself refreshes it
            // right after someone reads something there, but nothing ever
            // told it a roster was just PUBLISHED from this entirely
            // different page, so publishing here never lit the dot up until
            // a reload/relogin recomputed it from scratch ("有新的內容
            // bulletin分頁也沒有紅點"). Same fix, same reasoning as the line
            // just above.
            await refreshBulletinUpdates()
          }
        }
      }

      // A fresh save/publish just wrote real entries for this week again —
      // whatever got Cleared before is no longer the state of this period,
      // so the "clear a published week then publish" warning shouldn't
      // follow the manager into their NEXT Save/Submit click on this week.
      setClearedFromPublished(false)
      setLoadedPeriodStatus(status)
      setMessage(status === 'submitted' ? 'Roster submitted and published.' : 'Roster saved as draft.')
    } catch (err) {
      setMessage(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Save/Submit — either way, first check for any name on the grid (typed
  // by hand or left over from an upload) that isn't in User Management nor
  // already Pending staff, and pause on the same confirmation popup upload
  // uses before writing anything.
  async function persist(status) {
    const found = findsNeedingReview(entries)
    if (!found) {
      await doPersist(status, entries)
      return
    }
    if (!found.needsReview.length) {
      const resolved = applyPlan(entries, found.plan)
      setEntries(resolved)
      await doPersist(status, resolved)
      return
    }
    setImportReview({ parsed: entries, plan: found.plan, known: found.known, saveStatus: status })
  }

  // Jeff, 2026-10-01: "action裡新增clear, 如果按clear消除表格載入的資料，給
  // 有時候存好草稿(save not publish)但要清除資料時重做班表用" — wipes the
  // on-screen grid back to blank so the manager can rebuild a week's shifts
  // from scratch, without touching anything in the database until they
  // actually Save/Submit again (Clear itself never writes anything). Only
  // `entries` is cleared, deliberately leaving `notes` alone — Jeff's
  // wording was specifically "消除表格" (clear the TABLE/grid), not the
  // notes field below it. When the week currently loaded was already
  // published ('submitted'), remember that so a Submit & Publish click
  // right after Clear (with nothing rebuilt yet, or a rebuilt-but-different
  // week) gets the extra confirmation below instead of silently overwriting
  // a live roster with an empty/incomplete one.
  function clearGrid() {
    if (!window.confirm('Clear all shifts from this grid? This does not save anything until you Save/Submit again.')) return
    setEntries([])
    if (loadedPeriodStatus === 'submitted') setClearedFromPublished(true)
  }

  // Save/Submit's actual entry point now — the published-week block (just
  // added) comes first since it's an outright block with nothing to confirm
  // past, then the Clear-while-published case (see clearGrid/
  // clearedFromPublished above), which is a "did you mean to do this"
  // question about the SAVE ITSELF (overwriting a live published roster),
  // separate from and upstream of the understaffed-slots warning further
  // down, which is about staffing levels, not about publish-safety.
  function handleSaveOrSubmit(status) {
    if (status === 'draft' && loadedPeriodStatus === 'submitted') {
      setPublishedDraftBlocked(true)
      return
    }
    if (status === 'submitted' && clearedFromPublished) {
      setClearPublishConfirm({ status })
      return
    }
    proceedPastClearCheck(status)
  }

  function confirmClearPublishAndContinue() {
    const status = clearPublishConfirm.status
    setClearPublishConfirm(null)
    proceedPastClearCheck(status)
  }

  // Checks for understaffed slots (see the understaffedConfirm comment
  // above) and only calls persist() directly when there's nothing to warn
  // about, matching Jeff's "平常不顯示" (normally shows nothing at all).
  function proceedPastClearCheck(status) {
    const warnings = computeUnderstaffedWarnings(entries, rules)
    if (warnings.length) {
      setUnderstaffedConfirm({ status, warnings })
      return
    }
    persist(status)
  }

  function confirmUnderstaffedAndPersist() {
    const status = understaffedConfirm.status
    setUnderstaffedConfirm(null)
    persist(status)
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Manage Roster</h1>

      {/* Jeff, 2026-10-03: "View Staff's Availability跟Action 靠到最右邊。
          Save (not published)跟Submit & Publish還有說明則往日期那邊靠" —
          flips the single-row desktop layout from 2026-10-01 (which had
          everything — date, View Availability, Action, Save, Submit, info —
          in one plain left-aligned row): now two groups, Week starting +
          Save + Submit + info on the left, View Availability + Action
          pushed to the far right (`sm:justify-between` on the outer row,
          each side its own inner flex group so either side can still wrap
          internally without breaking the left/right split). Mobile keeps
          its own simpler stacked behavior — View Availability/Action swap
          to icon-only (👥/⋯, full text still in the accessible name via
          `title`) and Save/Submit shorten to "Save"/"Submit", per Jeff's
          earlier mobile-specific requests — it just now renders as two
          flex-wrap groups that stack via the outer row wrapping, instead of
          the old explicit spacer-forced two rows. */}
      <div className="mb-4 flex flex-wrap items-end gap-2 sm:flex-nowrap sm:justify-between sm:gap-3">
        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Week starting (Mon)</span>
            {/* Jeff, 2026-10-03 (screenshot): "選Week starting (Mon)一定要選
                禮拜一，如果是選其他天的話系統要自動跳到那個禮拜的禮拜一" — the
                date input itself can't be restricted to Mondays only (native
                <input type="date"> has no day-of-week filter), so instead any
                date picked here snaps forward to thisWeekStart() of THAT
                date — same Monday-start helper the "Current week"/"Last
                week"/"Next week" Action items below already use — rather
                than loading whatever non-Monday day was actually clicked. */}
            <input
              type="date"
              className="input"
              value={weekStart}
              onChange={(e) => {
                if (!e.target.value) return
                setWeekStart(thisWeekStart(parseISO(e.target.value)))
              }}
            />
          </label>

          <Button variant="secondary" disabled={saving || !!importReview} onClick={() => handleSaveOrSubmit('draft')}>
            <span className="sm:hidden">Save</span>
            <span className="hidden sm:inline">Save (not published)</span>
          </Button>
          <Button disabled={saving || !!importReview} onClick={() => handleSaveOrSubmit('submitted')}>
            <span className="sm:hidden">Submit</span>
            <span className="hidden sm:inline">Submit & Publish</span>
          </Button>
          <button
            type="button"
            onClick={() => setShowInstructions(true)}
            className="shrink-0 rounded-full border border-gray-200 px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-50 hover:text-brand-600"
            title="How to fill in the grid"
            aria-label="How to fill in the grid"
          >
            ℹ️
          </button>
        </div>

        <div className="flex items-end gap-2 sm:gap-3">
          <Button
            variant="secondary"
            onClick={() => setAvailabilityModalOpen(true)}
            disabled={!weekStart}
            title="View Staff's Availability"
            aria-label="View Staff's Availability"
          >
            <span className="sm:hidden" aria-hidden="true">👥</span>
            <span className="hidden sm:inline">View Staff's Availability</span>
          </Button>

          {/* Jeff, 2026-10-02 (screenshot): this dropdown used to be z-10,
              same as the grid's sticky day/date header below it (see
              RosterEntryGrid's 2026-10-01 "freeze header on scroll" change)
              — two siblings at the same z-index paint in DOM order, and the
              grid (mounted after this toolbar) came later, so its sticky
              header painted OVER this menu instead of under it. z-30 makes
              sure this transient dropdown always wins against anything
              sticky further down the page. */}
          <div className="relative" ref={actionMenuRef}>
            <Button variant="secondary" onClick={() => setActionMenuOpen((open) => !open)} title="Action" aria-label="Action">
              <span className="sm:hidden" aria-hidden="true">⋯</span>
              <span className="hidden sm:inline">Action ▾</span>
            </Button>
            {actionMenuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-brand-50"
                  onClick={() => {
                    setActionMenuOpen(false)
                    setWeekStart(format(addDays(parseISO(thisWeekStart()), -7), 'yyyy-MM-dd'))
                  }}
                >
                  Last week
                </button>
                <button
                  type="button"
                  className="block w-full px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-brand-50"
                  onClick={() => {
                    setActionMenuOpen(false)
                    setWeekStart(thisWeekStart())
                  }}
                >
                  Current week
                </button>
                <button
                  type="button"
                  className="block w-full px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-brand-50"
                  onClick={() => {
                    setActionMenuOpen(false)
                    setWeekStart(format(addDays(parseISO(thisWeekStart()), 7), 'yyyy-MM-dd'))
                  }}
                >
                  Next week
                </button>
                <div className="my-1 border-t border-gray-100" />
                <button
                  type="button"
                  className="block w-full px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-brand-50"
                  onClick={() => {
                    setActionMenuOpen(false)
                    fileInputRef.current?.click()
                  }}
                >
                  Upload Excel
                </button>
                <button
                  type="button"
                  className="block w-full px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-brand-50"
                  onClick={() => {
                    setActionMenuOpen(false)
                    downloadRosterTemplate(storeName, templateStaff, weekDates, `roster-template-${weekStart}.xlsx`)
                  }}
                >
                  Download template
                </button>
                <div className="my-1 border-t border-gray-100" />
                {/* Jeff, 2026-10-01: "action裡新增clear, 如果按clear消除表格
                    載入的資料" — own section at the bottom, visually
                    separated (red text, like MessagePage's delete action)
                    since it's destructive to what's on screen, unlike every
                    other item in this menu. */}
                <button
                  type="button"
                  className="block w-full px-3.5 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setActionMenuOpen(false)
                    clearGrid()
                  }}
                >
                  Clear
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0])}
            />
          </div>
        </div>
      </div>

      <Modal open={showInstructions} onClose={() => setShowInstructions(false)} title="How to fill in the grid">
        <p className="text-sm text-gray-600">
          Fill in the grid below — Start/End hours (e.g. 11, 22.5 for 10:30pm) and each day's Break in half-hour
          units (1 = 30 min, 2 = 1 hr) — or download the template, fill it in Excel, and upload it back. Total hr
          and WKD hr are calculated automatically.
        </p>
      </Modal>

      <RosterEntryGrid
        staff={staff}
        pendingStaff={pendingStaff}
        weekDates={weekDates}
        entries={entries}
        setEntries={setEntries}
        onHideStaff={persistHideStaff}
        availabilityByProfile={availabilityByProfile}
      />

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Notes</span>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {message && <p className="mt-2 text-sm text-brand-600">{message}</p>}

      {importReview && (
        <ImportReconcileModal
          items={importReview.plan.filter((p) => p.status === 'new')}
          known={importReview.known}
          onCancel={() => setImportReview(null)}
          onConfirm={confirmReview}
        />
      )}

      {weekStart && (
        <StaffAvailabilityModal
          open={availabilityModalOpen}
          onClose={() => setAvailabilityModalOpen(false)}
          staff={staff}
          weekStart={weekStart}
        />
      )}

      {understaffedConfirm && (
        <Modal
          open
          onClose={() => setUnderstaffedConfirm(null)}
          title="Understaffed slots"
          footer={
            <>
              <Button variant="secondary" onClick={() => setUnderstaffedConfirm(null)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={confirmUnderstaffedAndPersist}>
                {understaffedConfirm.status === 'submitted' ? 'Submit & Publish anyway' : 'Save anyway'}
              </Button>
            </>
          }
        >
          <UnderstaffedWarnings warnings={understaffedConfirm.warnings} />
        </Modal>
      )}

      {clearPublishConfirm && (
        <Modal
          open
          onClose={() => setClearPublishConfirm(null)}
          title="Publish over an already-published roster?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setClearPublishConfirm(null)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={confirmClearPublishAndContinue}>
                Publish anyway
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-700">
            This week's roster was already published, and the grid was cleared since then. Publishing now will
            replace the live, already-published roster with {entries.length ? "what's currently on the grid" : 'an empty roster'}
            . Staff who can already see their published shifts for this week will see this change.
          </p>
        </Modal>
      )}

      {publishedDraftBlocked && (
        <Modal
          open
          onClose={() => setPublishedDraftBlocked(false)}
          title="This roster is already published"
          footer={
            <Button onClick={() => setPublishedDraftBlocked(false)}>OK</Button>
          }
        >
          <p className="text-sm text-gray-700">
            This week's roster has already been published — Save (not published) would turn it back into an
            unpublished draft, which staff who can already see their published shifts wouldn't see reflected. To
            change an already-published roster, use Submit & Publish instead.
          </p>
        </Modal>
      )}
    </div>
  )
}
