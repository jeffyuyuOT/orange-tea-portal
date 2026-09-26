import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { getEffectivePages } from './permissions'

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
  // "Update" badges — see roster_change_events/roster_view_state (migration
  // 0047): `myRoster` is true when THIS person's own shift changed since
  // they last opened My Roster; `bulletin` is true when anyone's shift on
  // this store's roster changed since they last looked at the Bulletin
  // Board's Roster tab. Lives here (rather than in each page) so the
  // Sidebar — a separate component that's always mounted — can show the
  // My Roster badge too.
  const [rosterUpdates, setRosterUpdates] = useState({ myRoster: false, bulletin: false })

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
      if (profileRow.role === 'admin') {
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
    if (!currentStoreId && accessibleStores.length) {
      setCurrentStoreId(accessibleStores[0].id)
    }
  }, [accessibleStores]) // eslint-disable-line react-hooks/exhaustive-deps

  function setCurrentStoreId(id) {
    setCurrentStoreIdState(id)
    if (id) localStorage.setItem('ot_current_store_id', id)
  }

  // Recomputes both roster "Update" badges for the current person + store.
  // Called on login/store-switch, and again by My Roster / the Bulletin
  // Board's Roster tab right after they mark themselves as viewed, so the
  // badge disappears immediately without needing a full page reload.
  const refreshRosterUpdates = useCallback(async () => {
    if (!profile?.id || !currentStoreId) {
      setRosterUpdates({ myRoster: false, bulletin: false })
      return
    }
    const [{ data: viewState }, { data: changeRows }] = await Promise.all([
      supabase
        .from('roster_view_state')
        .select('my_roster_viewed_at, bulletin_roster_viewed_at')
        .eq('profile_id', profile.id)
        .eq('store_id', currentStoreId)
        .maybeSingle(),
      supabase.from('roster_change_events').select('profile_id, changed_at').eq('store_id', currentStoreId),
    ])
    // Reduce with '' (not null) as the seed — `changed_at` is always a
    // string, and comparing a string to null with `>` coerces null to 0 and
    // the string to NaN (Number("2026-...") is NaN), so `str > null` is
    // ALWAYS false and the reduce would never advance past the seed. '' as
    // the seed keeps this a plain string-vs-string comparison, which sorts
    // ISO timestamps correctly, and is still falsy for the `!!myLatest`/
    // `!!storeLatest` checks below when there are genuinely no rows.
    const myLatest = (changeRows ?? [])
      .filter((r) => r.profile_id === profile.id)
      .reduce((max, r) => (r.changed_at > max ? r.changed_at : max), '')
    const storeLatest = (changeRows ?? []).reduce((max, r) => (r.changed_at > max ? r.changed_at : max), '')
    setRosterUpdates({
      myRoster: !!myLatest && (!viewState?.my_roster_viewed_at || myLatest > viewState.my_roster_viewed_at),
      bulletin: !!storeLatest && (!viewState?.bulletin_roster_viewed_at || storeLatest > viewState.bulletin_roster_viewed_at),
    })
  }, [profile?.id, currentStoreId])

  useEffect(() => {
    refreshRosterUpdates()
  }, [refreshRosterUpdates])

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
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export { currentWeekStart }
