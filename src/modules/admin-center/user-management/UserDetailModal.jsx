import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { SECTIONS, getEffectivePages, roleSelectOptions, roleLabelFor } from '../../../lib/permissions'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Small ⓘ next to an option — click it to show the detail, click again (or
// anywhere else) to hide it.
function InfoTip({ label, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[11px] font-semibold leading-none text-gray-400 hover:border-brand-400 hover:text-brand-600"
        aria-label={`About ${label}`}
        aria-expanded={open}
        title={`About ${label}`}
      >
        i
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[75vw] whitespace-pre-line rounded-lg border border-brand-100 bg-white p-3 text-xs font-normal normal-case text-gray-600 shadow-lg">
          {children}
        </div>
      )}
    </span>
  )
}

export default function UserDetailModal({ user, onClose, onSaved }) {
  const { profile: me, accessibleStores } = useAuth()
  // First/last name live on `profiles` directly (not per-store), so they're
  // editable here regardless of whether this person is on any store's
  // roster at all — Staff Information can only edit a name once the person
  // shows up on a store's staff list, which requires a Store (or an "Also
  // on the roster at" checkbox) to be set first. An admin/user with no
  // store assigned (Store left at "—") never appears there, so without
  // this, the only way to give them a name was to temporarily assign a
  // store, rename them, then unassign it again.
  const [firstName, setFirstName] = useState(user.first_name ?? '')
  const [lastName, setLastName] = useState(user.last_name ?? '')
  const [role, setRole] = useState(user.role)
  const [storeId, setStoreId] = useState(user.primary_store_id ?? '')
  const [isActive, setIsActive] = useState(user.is_active)
  // Paid off the books rather than through normal payroll — set here so an
  // Accountant-role viewer's Staff Information list (and the underlying
  // RLS, see migration 0060_accountant_role_and_profile_fields.sql) can
  // leave this person out of what that role sees entirely.
  const [cashInHand, setCashInHand] = useState(user.cash_in_hand ?? false)
  // A capability WITHIN Shop Management > Staff Time Logs, not a whole page
  // of its own (see migration 0062_attendance_log_editing.sql) — lets this
  // person correct/backfill attendance punches with a required reason.
  // Same per-profile-column pattern as cash_in_hand above rather than the
  // page_key/permission_overrides system, since it isn't a page. Defaults
  // off for everyone (including shop_manager) per Jeff's spec; admin/
  // developer already have edit rights unconditionally at the RLS layer,
  // so this checkbox is a no-op for them either way.
  const [canEditAttendanceLogs, setCanEditAttendanceLogs] = useState(user.can_edit_attendance_logs ?? false)
  // Jeff, 2026-09-30: "staff information的TFN移到Address下面...只有
  // developer,admin跟accountant看的到...在shop managerment裡新增可勾取
  // Staff confidential，如果有勾取的話則可以看到從TFN，銀行資料跟上傳檔案
  // 那一區塊。manager預設不勾取" -- same per-profile-column pattern as
  // can_edit_attendance_logs right above (admin/developer/accountant
  // already see this block unconditionally in StaffDetailModal.jsx, so
  // this checkbox only matters for shop_manager). Defaults off.
  const [canViewStaffConfidential, setCanViewStaffConfidential] = useState(user.can_view_staff_confidential ?? false)
  const [overrides, setOverrides] = useState({}) // page_key -> boolean (explicit override) or undefined
  // Store(s) this person shows up on the roster for, beyond their primary
  // Store above — e.g. an admin who only actually works a couple of
  // stores, not every store the way `role: admin` used to imply for roster
  // purposes. Backed by user_stores (see migration 0027).
  const [extraStoreIds, setExtraStoreIds] = useState([])
  // Jeff, 2026-10-20 (point 3), reworked same day to per-store: "user
  // maangement裡分頁權限my dash board裡新增roster tab勾選，有勾選的話才能
  // 看到bulletin的roaster tab" — originally a single account-wide
  // profiles.can_view_roster_tab checkbox; Jeff flagged that a person on
  // two stores with conflicting "Disable roster" store settings couldn't
  // be represented by one global value, so this is now one checkbox PER
  // store the person belongs to (user_stores.can_view_roster_tab), same
  // shape as roster_display_name/hidden_from_roster. Keyed by store_id;
  // fetched alongside extraStoreIds below. A store with no row yet (just
  // checked under "also belong to", not saved) defaults true. Store
  // Management's "Disable roster" switch bulk-sets this for every current
  // member of that store — these checkboxes are how an individual gets set
  // differently afterward, independently per store.
  const [rosterTabByStore, setRosterTabByStore] = useState({})
  // Jeff, 2026-09: "Join store activity" — one flag for the whole person
  // (not per store), governing whether Store above AND every "also belong
  // to" store below treat them as a full active participant (schedulable,
  // in Roster Staff Order and staff availability, can apply for leave
  // there, shown in Staff Information/Learning Tracker/Staff Time Logs) or
  // just someone who can view that store's data. Originally the primary
  // Store was always exempt from this (always fully active regardless) —
  // changed by migration 0067 after Jeff's Janet example: she needs
  // Underwood as her actual primary Store, not just an "also belong to"
  // one, while still being excluded from scheduling there — so this now
  // applies to Store above too, not just the "also belong to" list (see
  // storeVisibility.js's isActiveStoreMember).
  const [joinStoreActivity, setJoinStoreActivity] = useState(user.join_store_activity ?? true)
  // Jeff, 2026-10-20: "Bypass exam" — this person never has to take the Title
  // Defend exam (Advanced / Master). Always on for someone who doesn't join
  // store activity (box locked ticked); optional for those who do. Migration
  // 0122 keeps the same rule in the database.
  const [bypassExam, setBypassExam] = useState(user.bypass_exam ?? false)
  const bypassExamEffective = !joinStoreActivity || bypassExam
  // There was briefly a second, separate "Post and receive Bulletin
  // messages" checkbox (join_bulletin_activity, migrations 0065/0066) —
  // Jeff removed it again the same day (migration
  // 0068_remove_bulletin_activity_checkbox.sql): admin/manager always
  // bypassed it anyway, so it only ever restricted a 'staff' account, and
  // that was rare enough not to need its own toggle — someone who
  // genuinely shouldn't use Bulletin at all just gets deactivated instead.
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  // Fresh Audit flags straight from the DB — accessibleStores is loaded at
  // login, so it goes stale after Audit is ticked in Store Management.
  const [auditStoreIds, setAuditStoreIds] = useState(null)
  // Jeff, 2026-10-20: same freshness concern as auditStoreIds above, needed
  // for the Roster tab checkboxes' default — a store NEWLY checked under
  // "also belong to" (not yet in user_stores at all) has no saved
  // can_view_roster_tab value yet, so its checkbox must default to match
  // that store's own "Disable roster" setting (Store Management), not a
  // blind `true`. Caught live: adding Underwood (disable_roster on) to a
  // profile showed the new Roster tab checkbox ticked, when it should
  // start unticked to match Underwood's own default for everyone else.
  const [disableRosterStoreIds, setDisableRosterStoreIds] = useState(null)
  const [loadedParts, setLoadedParts] = useState(0) // overrides + user_stores both read (2)
  useEffect(() => {
    supabase
      .from('stores')
      .select('id')
      .eq('audit_enabled', true)
      .then(({ data }) => setAuditStoreIds(new Set((data ?? []).map((r) => r.id))))
    supabase
      .from('stores')
      .select('id')
      .eq('disable_roster', true)
      .then(({ data }) => setDisableRosterStoreIds(new Set((data ?? []).map((r) => r.id))))
  }, [])

  // The default a store's Roster tab checkbox should show/save when this
  // person has no saved user_stores row for it yet (brand new membership) —
  // mirrors what Store Management's "Disable roster" bulk-toggle would set
  // for an existing member of that store. Optimistically true until
  // disableRosterStoreIds loads (near-instant; same tradeoff auditAvailable
  // below makes before auditReady).
  function defaultRosterTabFor(id) {
    return disableRosterStoreIds ? !disableRosterStoreIds.has(id) : true
  }

  useEffect(() => {
    supabase
      .from('permission_overrides')
      .select('*')
      .eq('profile_id', user.id)
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((o) => (map[o.page_key] = o.allowed))
        setOverrides(map)
        setLoadedParts((n) => n + 1)
      })
    supabase
      .from('user_stores')
      .select('store_id, can_view_roster_tab')
      .eq('profile_id', user.id)
      .then(({ data }) => {
        setExtraStoreIds((data ?? []).map((r) => r.store_id).filter((id) => id !== (user.primary_store_id ?? '')))
        const rosterTabMap = {}
        ;(data ?? []).forEach((r) => {
          rosterTabMap[r.store_id] = r.can_view_roster_tab !== false
        })
        setRosterTabByStore(rosterTabMap)
        setLoadedParts((n) => n + 1)
      })
  }, [user.id, user.primary_store_id])

  function toggleExtraStore(id) {
    setExtraStoreIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleRosterTab(id) {
    setRosterTabByStore((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultRosterTabFor(id)) }))
  }

  const effective = getEffectivePages(
    { role },
    Object.entries(overrides).map(([page_key, allowed]) => ({ page_key, allowed }))
  )

  // Jeff, 2026-10-18: Audit is switched on per store (Store Management). A
  // non-admin only gets the Audit pages if one of THEIR stores has it on, so
  // the checkboxes are locked off until then (AuthContext.jsx applies the same
  // rule to what the person actually sees).
  // Jeff, 2026-10-19: only shop managers (plus admin/developer) can have Audit,
  // and a shop manager only with an Audit-enabled store. Change the role to staff
  // or move them to a store without Audit and the ticks clear themselves
  // (effect below) and the boxes lock.
  const auditAvailable =
    role === 'admin' ||
    role === 'developer' ||
    (role === 'shop_manager' && [storeId, ...extraStoreIds].some((id) => id && (auditStoreIds ? auditStoreIds.has(id) : accessibleStores.find((s) => s.id === id)?.audit_enabled)))

  const auditReady = loadedParts >= 2 && auditStoreIds !== null // don't judge before the data is in
  useEffect(() => {
    if (!auditReady || auditAvailable) return
    setOverrides((prev) => {
      const keys = Object.keys(prev).filter((k) => k.startsWith('audit.'))
      if (!keys.length) return prev
      const copy = { ...prev }
      keys.forEach((k) => delete copy[k])
      return copy
    })
  }, [auditReady, auditAvailable, overrides])

  function togglePage(pageKey, roleDefault) {
    setOverrides((prev) => {
      const current = pageKey in prev ? prev[pageKey] : roleDefault
      const next = !current
      const copy = { ...prev }
      if (next === roleDefault) delete copy[pageKey] // back to role default, no override needed
      else copy[pageKey] = next
      return copy
    })
  }

  async function save() {
    setSaving(true)
    // Jeff, 2026-09: this used to fire-and-forget every write in save(),
    // so when THIS specific update failed (e.g. a stale PostgREST schema
    // cache right after a migration added a new profiles column — see
    // handoff notes), nothing told Jeff it hadn't saved — the modal just
    // closed as if it had, and the very next writes below (permission
    // overrides, user_stores) went ahead regardless, silently splitting
    // one "Save" into a half-applied change. Now it stops and surfaces the
    // error immediately, the same way StaffDetailModal.jsx already does.
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role,
        primary_store_id: storeId || null,
        is_active: isActive,
        cash_in_hand: cashInHand,
        can_edit_attendance_logs: canEditAttendanceLogs,
        can_view_staff_confidential: canViewStaffConfidential,
        join_store_activity: joinStoreActivity,
        bypass_exam: bypassExamEffective,
      })
      .eq('id', user.id)
    if (profileError) {
      alert(`Save failed: ${profileError.message}`)
      setSaving(false)
      return
    }
    await supabase.from('permission_overrides').delete().eq('profile_id', user.id)
    const meName = `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim() || me.email
    const rows = Object.entries(overrides).map(([page_key, allowed]) => ({
      profile_id: user.id,
      page_key,
      allowed,
      updated_by: me.id,
      updated_by_name: meName,
    }))
    if (rows.length) await supabase.from('permission_overrides').insert(rows)

    // Sync user_stores to exactly {Store above} ∪ {checked extra stores} —
    // this is what Manage Roster / Name display use to decide which
    // store(s) this person appears on, instead of assuming an admin
    // belongs on every store's roster.
    //
    // Only the difference is written: a store they stay on keeps its row (so its
    // roster order, roster name and hidden flag survive saving this form), a store
    // they are taken off is deleted, and a store they are newly added to gets a row
    // that starts HIDDEN from the roster (Roster Hub › Setting › Roster Staff Order →
    // "Not shown on the roster") — a new person is not scheduled until a manager
    // restores them there, unless they are linked to a Pending staff name that was
    // already on the roster (UserManagementPage.linkPending takes over that name's place).
    const storeIds = Array.from(new Set([storeId, ...extraStoreIds].filter(Boolean)))
    const { data: existingRows, error: readError } = await supabase.from('user_stores').select('store_id').eq('profile_id', user.id)
    if (readError) {
      alert(`Save failed while updating stores: ${readError.message}`)
      setSaving(false)
      return
    }
    const existingIds = new Set((existingRows ?? []).map((r) => r.store_id))
    const toRemove = [...existingIds].filter((id) => !storeIds.includes(id))
    const toAdd = storeIds.filter((id) => !existingIds.has(id))
    if (toRemove.length) await supabase.from('user_stores').delete().eq('profile_id', user.id).in('store_id', toRemove)
    if (toAdd.length) {
      const { error: storeError } = await supabase
        .from('user_stores')
        .insert(toAdd.map((id) => ({ profile_id: user.id, store_id: id, hidden_from_roster: true, can_view_roster_tab: rosterTabByStore[id] ?? defaultRosterTabFor(id) })))
      if (storeError) {
        alert(`Save failed while updating stores: ${storeError.message}`)
        setSaving(false)
        return
      }
    }
    // A store the person KEEPS (not newly added, not removed) may still
    // have had its own Roster tab checkbox changed above — write those
    // separately so a kept row's roster_display_name/roster_order/
    // hidden_from_roster survive untouched (toAdd's insert above already
    // covers the brand-new rows).
    const toUpdateRosterTab = storeIds.filter((id) => existingIds.has(id))
    if (toUpdateRosterTab.length) {
      const results = await Promise.all(
        toUpdateRosterTab.map((id) =>
          supabase.from('user_stores').update({ can_view_roster_tab: rosterTabByStore[id] ?? defaultRosterTabFor(id) }).eq('profile_id', user.id).eq('store_id', id)
        )
      )
      const rosterTabErr = results.find((r) => r.error)?.error
      if (rosterTabErr) {
        alert(`Save failed while updating stores: ${rosterTabErr.message}`)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    onSaved()
  }

  // "Remove" here is the same soft-deactivate as Shop Management > Staff
  // Information's "Remove staff" — sets is_active false rather than
  // deleting anything, so roster/leave/quiz history is preserved. A true
  // delete of the login itself can only be done from the Supabase
  // Dashboard (Authentication > Users), and even then only cascades
  // cleanly if this person never created content that other tables track
  // by who-created-it (announcements, formula/quiz items, uploaded
  // files, etc.) — those reference profiles without cascading.
  async function deactivate() {
    await supabase.from('profiles').update({ is_active: false }).eq('id', user.id)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email}
      footer={
        <>
          <Button variant="danger" onClick={() => setConfirmRemove(true)}>
            Remove
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">First name</span>
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Last name</span>
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
        <p className="col-span-2 -mt-1 text-xs text-gray-400">
          Sets this person's name directly — works even if they're not assigned to any Store below, unlike Shop
          Management &gt; Staff Information (which needs them on a store's roster first). A per-store "Display
          name" (shown instead of this on Bulletin Board, Manage Roster, etc.) can still be set from Staff
          Information once they're on a store.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="block">
          <label className="mb-1 block text-xs font-medium text-gray-500">Role</label>
          <select
            className="input"
            value={role}
            onChange={(e) => {
              const next = e.target.value
              setRole(next)
              // Jeff, 2026-10-21: "2d maker跟accountant可以變成預設join store
              // activity不勾選，就不會收到任何訊息通知" — these two aren't
              // people actively watching a store's bulletin/roster (a device
              // account and an outside bookkeeper), so switching TO one of
              // them here defaults Join store activity off — same effect as
              // unchecking it by hand, just one less step, and still a plain
              // checkbox the admin can re-check afterward if this particular
              // person is the exception.
              if (['qr_code_maker', 'accountant'].includes(next) && !['qr_code_maker', 'accountant'].includes(role)) {
                setJoinStoreActivity(false)
              }
            }}
          >
            {roleSelectOptions(user.role, me?.role).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={cashInHand} onChange={(e) => setCashInHand(e.target.checked)} />
            Cash-in-hand
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Store</span>
          <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">—</option>
            {accessibleStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-5 flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>

      {accessibleStores.length > 1 && (
        <div className="mb-5">
          <span className="mb-1 block text-xs font-medium text-gray-500">also belong to (in addition to Store above)</span>
          <div className="flex flex-wrap gap-3">
            {accessibleStores
              .filter((s) => s.id !== storeId)
              .map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm text-gray-600">
                  <input type="checkbox" checked={extraStoreIds.includes(s.id)} onChange={() => toggleExtraStore(s.id)} />
                  {s.name}
                </label>
              ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={joinStoreActivity} onChange={(e) => setJoinStoreActivity(e.target.checked)} />
              Join store activity
            </label>
            {/* Jeff, 2026-09 — exact verbatim wording, applies to Store above
                AND every "also belong to" store checked here (see migration
                0067 / storeVisibility.js's isActiveStoreMember). */}
            <InfoTip label="Join store activity">
              {'Checked:  full active participant at Manage Roster (including applying for leave/staff availability/listed in Roster Staff Order)/shown in Staff Information/Learning Tracker/Staff Time Logs there. \nUnchecked: View-only access (can switch to the store, but excluded from all rosters and tracking), and also stops push notifications and the Bulletin/Roster red-dot for that store — someone this is off for is not expected to be actively watching what gets posted there.'}
            </InfoTip>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={bypassExamEffective}
                disabled={!joinStoreActivity}
                onChange={(e) => setBypassExam(e.target.checked)}
              />
              Bypass exam
            </label>
            <InfoTip label="Bypass exam">
              Checked: no Title Defend exam for this person. Always checked (and locked) while Join store activity is off.
            </InfoTip>
          </div>
        </div>
      )}

      {Array.from(new Set([storeId, ...extraStoreIds].filter(Boolean))).length > 0 && (
        <div className="mb-5">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500">Roster tab (Bulletin Board) — per store</span>
            <InfoTip label="Roster tab">
              {'Unchecked for a store: the Roster filter/feed disappears from this person\'s Bulletin Board entirely while they\'re at that store. \nStore Management\'s "Disable roster" switch bulk-sets this for everyone currently at that store — these checkboxes are how an individual gets set differently afterward, independently per store (e.g. on for one store, off for another).'}
            </InfoTip>
          </div>
          <div className="flex flex-wrap gap-3">
            {Array.from(new Set([storeId, ...extraStoreIds].filter(Boolean))).map((id) => {
              const storeName = accessibleStores.find((s) => s.id === id)?.name ?? '—'
              return (
                <label key={id} className="flex items-center gap-1.5 text-sm text-gray-600">
                  <input type="checkbox" checked={rosterTabByStore[id] ?? defaultRosterTabFor(id)} onChange={() => toggleRosterTab(id)} />
                  {storeName}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {confirmRemove && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Remove {firstName || user.email} from active staff? This sets them inactive rather than
          permanently deleting their history — they'll stop being able to sign in, but their roster, leave,
          and quiz records are kept.
          <div className="mt-2 flex gap-2">
            <Button variant="danger" onClick={deactivate}>
              Confirm remove
            </Button>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <h4 className="mb-2 text-sm font-semibold text-brand-700">Page Access</h4>
      <div className="space-y-3">
        {Object.entries(SECTIONS)
          .filter(([sectionKey]) => sectionKey !== 'developer_tools' || me?.role === 'developer')
          .map(([sectionKey, section]) => (
          <div key={sectionKey}>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-400">
              {section.label}
              {sectionKey === 'audit' && (
                <InfoTip label="Audit">
                  Audit is only for shop managers whose store has Audit switched on (tick it on the store in Store Management). Ticks clear automatically otherwise.
                </InfoTip>
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              {Object.entries(section.pages).map(([pageKey, pageLabel]) => {
                const fullKey = `${sectionKey}.${pageKey}`
                const auditLocked = sectionKey === 'audit' && !auditAvailable
                const checked = effective.has(fullKey) && !auditLocked
                const isOverridden = fullKey in overrides
                return (
                  <label key={fullKey} className={`flex items-center gap-1.5 text-sm ${isOverridden ? 'text-brand-700 font-medium' : 'text-gray-600'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={auditLocked}
                      onChange={() => {
                        const roleDefaultSet = getEffectivePages({ role }, [])
                        togglePage(fullKey, roleDefaultSet.has(fullKey))
                      }}
                    />
                    {pageLabel}
                    {isOverridden && <span className="text-brand-400">*</span>}
                  </label>
                )
              })}
              {sectionKey === 'shop_management' && (
                <>
                  {/* Jeff, 2026-09-30: "Edit attendance logs和Staff
                      confidential可以用紅字表示嗎" -- red label text (not
                      the checkbox itself) so these two sensitive,
                      off-by-default permissions stand out from the ordinary
                      page-visibility checkboxes above. */}
                  <label className="flex items-center gap-1.5 text-sm font-medium text-red-600">
                    <input
                      type="checkbox"
                      checked={canEditAttendanceLogs}
                      onChange={(e) => setCanEditAttendanceLogs(e.target.checked)}
                    />
                    Edit attendance logs
                  </label>
                  <label className="flex items-center gap-1.5 text-sm font-medium text-red-600">
                    <input
                      type="checkbox"
                      checked={canViewStaffConfidential}
                      onChange={(e) => setCanViewStaffConfidential(e.target.checked)}
                    />
                    Staff confidential
                  </label>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-400">* = overridden from the {roleLabelFor(role, me?.role)} role default</p>
    </Modal>
  )
}
