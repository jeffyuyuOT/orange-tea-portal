import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { addMonths } from 'date-fns'
import { supabase } from './supabaseClient'
import { getEffectivePages, canAccessPage } from './permissions'
import { getUnseenFormulaItems } from './formulaUpdates'
import { getStaffTimeDiscrepancies, isUnreadDiscrepancy } from './timeDiscrepancy'
import { DEFAULT_SIDEBAR_ORDER, fetchSidebarOrder } from './sidebarOrder'

const AuthContext = createContext(null)

// Monday-start week key, e.g. "2026-09-14"
function currentWeekStart(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay() // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [overrides, setOverrides] = useState([])
  const [accessibleStores, setAccessibleStores] = useState([])
  const [currentStoreId, setCurrentStoreIdState] = useState(
    () => localStorage.getItem('ot_current_store_id') || null
  )
  const [loading, setLoading] = useState(true)
  // Training-role users must additionally verify a weekly 4-digit code
  // before the session is treated as "fully signed in".
  const [needsTrainingCode, setNeedsTrainingCode] = useState(false)
  // "Update" badge for My Roster — see roster_change_events/roster_view_state
  // (migration 0047): true when THIS person's own shift changed since they
  // last opened My Roster. Lives here (rather than in the page itself) so
  // the Sidebar — a separate component that's always mounted — can show it.
  // (The Bulletin Board's Roster feed used to have an equivalent `bulletin`
  // flag here too, but that was a single per-store "have they looked at the
  // Roster tab at all" timestamp — clearing every week's badge at once just
  // from switching tabs, even for weeks never actually opened. Migration
  // 0048 replaced that with per-week view tracking that BulletinPage.jsx
  // now computes and owns entirely on its own, so there's nothing for this
  // context to track for it any more.)
  const [rosterUpdates, setRosterUpdates] = useState({ myRoster: false })
  // "Update" badge next to Formula in the Sidebar — see migration 0053 /
  // src/lib/formulaUpdates.js: true when at least one formula item visible
  // at this store is new or has been edited (by anyone) since this person
  // last opened it. Lives here for the same reason rosterUpdates does — the
  // Sidebar is a separate, always-mounted component.
  const [hasFormulaUpdates, setHasFormulaUpdates] = useState(false)
  // Small red dot next to Bulletin in the Sidebar (Jeff, 2026-09) — true the
  // moment ANY of the three "unviewed" signals BulletinPage.jsx already
  // computes for its own Roster / Store Announcement / Customer Complaint
  // tab dots (hasUnviewedRoster/hasUnviewedAnnouncement/hasUnviewedComplaint
  // there) would be true, so the Sidebar can hint "something's here" before
  // the person has even opened Bulletin — same idea as rosterUpdates/
  // hasFormulaUpdates above, computed independently here for the same
  // reason (Sidebar is a separate, always-mounted component), reading the
  // same underlying tables (announcements/announcement_reads,
  // roster_periods/roster_change_events/roster_period_views) rather than
  // sharing code with BulletinPage's fuller item-list computation. Quiz
  // reminders are deliberately NOT included — BulletinPage doesn't count
  // them as "unviewed" either, since they're a standing status rather than
  // a one-off post.
  const [hasBulletinUpdates, setHasBulletinUpdates] = useState(false)
  // Circled number on the Message nav entry (Jeff, 2026-09 — Message moved
  // out of Bulletin Board into its own personal "My Dashboard" tab, see
  // MessagePage.jsx). Unlike hasBulletinUpdates above, this is NOT
  // store-scoped — a message follows the person, not the currently
  // switched-to store — so it only depends on profile.id, and counts
  // (rather than just flags) every message_recipients row for this person
  // with read_at still null, across every store at once.
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  // Small red dot next to Staff Time Logs in the Sidebar (Jeff, 2026-09:
  // "staff time logs那裏也會有紅點提示") — true when at least one staff
  // member at this store has an unread clock-time-vs-roster discrepancy for
  // THIS viewer (see src/lib/timeDiscrepancy.js) — same per-viewer "red dot,
  // not a count" treatment as hasBulletinUpdates above, and same reasoning
  // for living here rather than in the page itself (Sidebar is a separate,
  // always-mounted component). Only ever computed for a role that can
  // actually reach that page — a plain staff account has no business
  // querying other people's punches/roster just to light up a badge it'll
  // never see anyway.
  const [hasTimeDiscrepancies, setHasTimeDiscrepancies] = useState(false)
  // Shared Sidebar section/page order (migration 0055) — global, not tied
  // to who's logged in, so it's fetched once independently of profile/store
  // rather than inside loadProfileData. Starts as SECTIONS' own literal
  // order (DEFAULT_SIDEBAR_ORDER) so the Sidebar has something sane to
  // render on the very first paint, before this fetch resolves.
  const [sidebarOrder, setSidebarOrder] = useState(DEFAULT_SIDEBAR_ORDER)

  const refreshSidebarOrder = useCallback(async () => {
    setSidebarOrder(await fetchSidebarOrder())
  }, [])

  useEffect(() => {
    refreshSidebarOrder()
  }, [refreshSidebarOrder])

  const loadProfileData = useCallback(async (userId) => {
    const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(profileRow ?? null)

    if (profileRow) {
      const { data: overrideRows } = await supabase
        .from('permission_overrides')
        .select('page_key, allowed')
        .eq('profile_id', userId)
      setOverrides(overrideRows ?? [])

      let storeIds = new Set()
      if (profileRow.primary_store_id) storeIds.add(profileRow.primary_store_id)
      // developer is admin's superset (see permissions.js / migration
      // 0058_developer_is_admin_superset.sql) — same "sees every store"
      // treatment, not scoped to whatever user_stores rows it happens to
      // have (it may have none at all, same as a fresh admin account).
      if (profileRow.role === 'admin' || profileRow.role === 'developer') {
        const { data: allStores } = await supabase.from('stores').select('id, name, code').eq('is_active', true)
        setAccessibleStores(allStores ?? [])
      } else {
        const { data: userStoreRows } = await supabase
          .from('user_stores')
          .select('store_id, stores ( id, name, code )')
          .eq('profile_id', userId)
        userStoreRows?.forEach((r) => r.store_id && storeIds.add(r.store_id))
        const ids = Array.from(storeIds)
        if (ids.length) {
          const { data: storeRows } = await supabase.from('stores').select('id, name, code').in('id', ids)
          setAccessibleStores(storeRows ?? [])
        } else {
          setAccessibleStores([])
        }
      }

      setNeedsTrainingCode(profileRow.role === 'training' && !sessionStorage.getItem('ot_training_verified'))
    }
  }, [])

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user) await loadProfileData(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      if (newSession?.user) {
        await loadProfileData(newSession.user.id)
      } else {
        setProfile(null)
        setOverrides([])
        setAccessibleStores([])
      }
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfileData])

  useEffect(() => {
    // Once we know which stores the user can see, default the active store.
    // Also corrects a STALE currentStoreId — it's cached in localStorage per
    // BROWSER, not per account, so a phone/computer that was previously
    // signed in as a different person (or where this same person's store
    // assignment changed) can carry over a store id that isn't in this
    // account's accessibleStores at all. Without this check that stale id
    // just sits there forever (the old "only reset if empty" version never
    // corrected it), and any page that resolves the current store by
    // looking it up in accessibleStores — e.g. QrCodeDisplayPage — quietly
    // renders as "no store selected" while the header's StoreSwitcher still
    // looks fine (it shows accessibleStores[0].name directly whenever
    // there's exactly one, without checking currentStoreId at all).
    if (accessibleStores.length && !accessibleStores.some((s) => s.id === currentStoreId)) {
      setCurrentStoreId(accessibleStores[0].id)
    }
  }, [accessibleStores]) // eslint-disable-line react-hooks/exhaustive-deps

  function setCurrentStoreId(id) {
    setCurrentStoreIdState(id)
    if (id) localStorage.setItem('ot_current_store_id', id)
  }

  // Recomputes the My Roster "Update" badge for the current person + store.
  // Called on login/store-switch, and again by My Roster right after they
  // mark themselves as viewed, so the badge disappears immediately without
  // needing a full page reload.
  const refreshRosterUpdates = useCallback(async () => {
    if (!profile?.id || !currentStoreId) {
      setRosterUpdates({ myRoster: false })
      return
    }
    const [{ data: viewState }, { data: changeRows }] = await Promise.all([
      supabase
        .from('roster_view_state')
        .select('my_roster_viewed_at')
        .eq('profile_id', profile.id)
        .eq('store_id', currentStoreId)
        .maybeSingle(),
      supabase.from('roster_change_events').select('changed_at').eq('store_id', currentStoreId).eq('profile_id', profile.id),
    ])
    // Reduce with '' (not null) as the seed — `changed_at` is always a
    // string, and comparing a string to null with `>` coerces null to 0 and
    // the string to NaN (Number("2026-...") is NaN), so `str > null` is
    // ALWAYS false and the reduce would never advance past the seed. '' as
    // the seed keeps this a plain string-vs-string comparison, which sorts
    // ISO timestamps correctly, and is still falsy for the `!!myLatest`
    // check below when there are genuinely no rows.
    const myLatest = (changeRows ?? []).reduce((max, r) => (r.changed_at > max ? r.changed_at : max), '')
    setRosterUpdates({
      myRoster: !!myLatest && (!viewState?.my_roster_viewed_at || myLatest > viewState.my_roster_viewed_at),
    })
  }, [profile?.id, currentStoreId])

  useEffect(() => {
    refreshRosterUpdates()
  }, [refreshRosterUpdates])

  // Recomputes the Formula "Update" badge for the current person + store.
  // Called on login/store-switch, and again by FormulaItemDetail right
  // after someone opens an item (which marks it seen), so the badge clears
  // immediately without needing a full page reload.
  const refreshFormulaUpdates = useCallback(async () => {
    if (!profile?.id || !currentStoreId) {
      setHasFormulaUpdates(false)
      return
    }
    const unseen = await getUnseenFormulaItems(profile.id, currentStoreId)
    setHasFormulaUpdates(unseen.length > 0)
  }, [profile?.id, currentStoreId])

  useEffect(() => {
    refreshFormulaUpdates()
  }, [refreshFormulaUpdates])

  // Recomputes the Bulletin "Update" dot for the current person + store.
  // Called on login/store-switch, and again by BulletinPage right after it
  // marks something read (an announcement/complaint opened, or a roster
  // week opened), so the dot clears immediately without needing a full page
  // reload — same trigger points as refreshRosterUpdates/refreshFormulaUpdates.
  const refreshBulletinUpdates = useCallback(async () => {
    if (!profile?.id || !currentStoreId) {
      setHasBulletinUpdates(false)
      return
    }
    // Same one-month drop-out window BulletinPage.jsx applies to normal
    // announcements and roster postings (customer complaints stay until
    // solved, so no window there) — an item outside this window never shows
    // in the feed at all, so it shouldn't light up the Sidebar dot either.
    const oneMonthAgo = addMonths(new Date(), -1).toISOString()
    const [
      { data: announcementRows },
      { data: complaintRows },
      { data: rosterRows },
      { data: changeEventRows },
      { data: periodViewRows },
      { data: announcementReadRows },
    ] = await Promise.all([
      supabase
        .from('announcements')
        .select('id, updated_at')
        .eq('store_id', currentStoreId)
        .eq('category', 'normal')
        .gte('updated_at', oneMonthAgo),
      supabase.from('announcements').select('id, updated_at').eq('store_id', currentStoreId).eq('category', 'customer_complaint'),
      supabase
        .from('roster_periods')
        .select('id')
        .eq('store_id', currentStoreId)
        .eq('status', 'submitted')
        .not('submitted_at', 'is', null)
        .gte('submitted_at', oneMonthAgo),
      supabase.from('roster_change_events').select('roster_period_id, changed_at').eq('store_id', currentStoreId),
      supabase.from('roster_period_views').select('roster_period_id, viewed_at').eq('profile_id', profile.id),
      supabase.from('announcement_reads').select('announcement_id, read_at').eq('profile_id', profile.id),
    ])

    // Never opened at all, or opened before but edited again since — same
    // "New or Update" definition BulletinPage.jsx's readFlags() uses.
    const readAtById = new Map((announcementReadRows ?? []).map((r) => [r.announcement_id, r.read_at]))
    const isUnviewedAnnouncement = (a) => {
      const readAt = readAtById.get(a.id)
      return !readAt || readAt < a.updated_at
    }
    const hasUnviewedAnnouncement = (announcementRows ?? []).some(isUnviewedAnnouncement)
    const hasUnviewedComplaint = (complaintRows ?? []).some(isUnviewedAnnouncement)

    // Same per-period comparison as BulletinPage.jsx's rosterItems mapping —
    // '' (not null) as the reduce seed for the same reason refreshRosterUpdates
    // above uses it (string-vs-null comparisons with `>` always come out false).
    const periodLatestChange = new Map()
    ;(changeEventRows ?? []).forEach((r) => {
      const cur = periodLatestChange.get(r.roster_period_id) ?? ''
      if (r.changed_at > cur) periodLatestChange.set(r.roster_period_id, r.changed_at)
    })
    const periodViewedAt = new Map((periodViewRows ?? []).map((r) => [r.roster_period_id, r.viewed_at]))
    const hasUnviewedRoster = (rosterRows ?? []).some((r) => {
      const latestChange = periodLatestChange.get(r.id)
      const viewedAt = periodViewedAt.get(r.id)
      return !!latestChange && (!viewedAt || latestChange > viewedAt)
    })

    setHasBulletinUpdates(hasUnviewedAnnouncement || hasUnviewedComplaint || hasUnviewedRoster)
  }, [profile?.id, currentStoreId])

  useEffect(() => {
    refreshBulletinUpdates()
  }, [refreshBulletinUpdates])

  // Recomputes the Message unread badge for the current person — called on
  // login, and again by MessagePage right after it marks something read (or
  // sends/receives), so the badge updates without a full page reload. Not
  // tied to currentStoreId — see the state comment above.
  const refreshUnreadMessages = useCallback(async () => {
    if (!profile?.id) {
      setUnreadMessageCount(0)
      return
    }
    const { count } = await supabase
      .from('message_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id)
      .is('read_at', null)
    setUnreadMessageCount(count ?? 0)
  }, [profile?.id])

  useEffect(() => {
    refreshUnreadMessages()
  }, [refreshUnreadMessages])

  // Recomputes the Staff Time Logs red dot for the current person + store.
  // Called on login/store-switch, and again by StaffTimeLogsPage right
  // after it marks a staff member's discrepancy seen (time_discrepancy_views
  // upsert), so the dot updates without a full page reload — same trigger
  // shape as refreshBulletinUpdates/refreshFormulaUpdates above.
  const refreshTimeDiscrepancies = useCallback(async () => {
    if (!profile?.id || !currentStoreId || !canAccessPage(getEffectivePages(profile, overrides), 'shop_management.staff_time_logs')) {
      setHasTimeDiscrepancies(false)
      return
    }
    const { data: staffRows } = await supabase.from('user_stores').select('profile_id').eq('store_id', currentStoreId)
    const profileIds = Array.from(new Set((staffRows ?? []).map((r) => r.profile_id).filter(Boolean)))
    if (!profileIds.length) {
      setHasTimeDiscrepancies(false)
      return
    }
    const [discrepancies, { data: viewRows }] = await Promise.all([
      getStaffTimeDiscrepancies(currentStoreId, profileIds),
      supabase.from('time_discrepancy_views').select('subject_profile_id, viewed_at').eq('viewer_id', profile.id).in('subject_profile_id', profileIds),
    ])
    const viewedAtBySubject = new Map((viewRows ?? []).map((r) => [r.subject_profile_id, r.viewed_at]))
    const hasUnread = Object.entries(discrepancies).some(([subjectId, d]) => isUnreadDiscrepancy(d, viewedAtBySubject.get(subjectId)))
    setHasTimeDiscrepancies(hasUnread)
  }, [profile, overrides, currentStoreId])

  useEffect(() => {
    refreshTimeDiscrepancies()
  }, [refreshTimeDiscrepancies])

  const signIn = useCallback(async (email, password) => {
    sessionStorage.removeItem('ot_training_verified')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const verifyTrainingCode = useCallback(
    async (code) => {
      if (!profile?.primary_store_id) throw new Error('No store assigned to this training account yet.')
      const weekStart = currentWeekStart()
      const { data, error } = await supabase
        .from('training_codes')
        .select('code')
        .eq('store_id', profile.primary_store_id)
        .eq('week_start', weekStart)
        .single()
      if (error || !data) throw new Error("This week's training code hasn't been generated yet. Ask your manager.")
      if (data.code !== code.trim()) throw new Error('Incorrect training code.')
      sessionStorage.setItem('ot_training_verified', '1')
      setNeedsTrainingCode(false)
    },
    [profile]
  )

  const signOut = useCallback(async () => {
    sessionStorage.removeItem('ot_training_verified')
    await supabase.auth.signOut()
  }, [])

  const effectivePages = useMemo(() => getEffectivePages(profile, overrides), [profile, overrides])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    needsTrainingCode,
    verifyTrainingCode,
    signIn,
    signOut,
    effectivePages,
    accessibleStores,
    currentStoreId,
    setCurrentStoreId,
    refreshProfile: () => session?.user && loadProfileData(session.user.id),
    rosterUpdates,
    refreshRosterUpdates,
    hasFormulaUpdates,
    refreshFormulaUpdates,
    hasBulletinUpdates,
    refreshBulletinUpdates,
    unreadMessageCount,
    refreshUnreadMessages,
    hasTimeDiscrepancies,
    refreshTimeDiscrepancies,
    sidebarOrder,
    refreshSidebarOrder,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export { currentWeekStart }
