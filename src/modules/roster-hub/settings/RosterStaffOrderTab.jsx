import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { useDragReorder, DragHandle } from '../../../lib/useDragReorder'
import { rosterDisplayName, pendingRosterName } from '../../../lib/excelRoster'
import { NON_ROSTER_STAFF_ROLES } from '../../../lib/permissions'

// Manage Roster's staff list (real staff via user_stores + not-yet-formal
// Pending staff via roster_pending_staff — the same two sources
// ManageRosterPage.jsx combines into one grid) used to come back in
// whatever order Postgres happened to return; there was never an ORDER BY
// on it. This tab lets a manager drag both into one explicit order
// (migration 0059_roster_staff_order_and_hide.sql's `roster_order`, shared
// across both tables so a Pending hire can sit anywhere among real staff,
// not only after them), and set aside anyone who shouldn't auto-populate
// the grid right now (`hidden_from_roster` — the same flag Manage
// Roster's ✕ next to a name sets) until they're explicitly restored here
// — which is also the only place they get added back into the order.
export default function RosterStaffOrderTab() {
  const { currentStoreId } = useAuth()
  const [items, setItems] = useState([])
  const [hidden, setHidden] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true)
    const [{ data: staffRows }, { data: pendingRows }] = await Promise.all([
      supabase
        .from('user_stores')
        .select('profile_id, roster_display_name, roster_order, hidden_from_roster, profiles(id, first_name, last_name, is_active, role)')
        .eq('store_id', currentStoreId),
      supabase.from('roster_pending_staff').select('*').eq('store_id', currentStoreId),
    ])
    // 2D Code Maker / training accounts don't get scheduled at all (same
    // NON_ROSTER_STAFF_ROLES exclusion Manage Roster/History exports use)
    // — they never belong in a roster's order OR its "hidden" list, since
    // they were never part of the roster to begin with. developer is
    // deliberately NOT excluded here — it can be scheduled/ordered like
    // any other role once assigned to a store (see NON_ROSTER_STAFF_ROLES'
    // own comment in permissions.js).
    const staffAsItems = (staffRows ?? [])
      .filter((r) => r.profiles?.is_active && !NON_ROSTER_STAFF_ROLES.includes(r.profiles.role))
      .map((r) => ({
        id: `staff:${r.profile_id}`,
        kind: 'staff',
        refId: r.profile_id,
        name: rosterDisplayName({ ...r.profiles, roster_display_name: r.roster_display_name }),
        roster_order: r.roster_order,
        hidden_from_roster: r.hidden_from_roster,
      }))
    const pendingAsItems = (pendingRows ?? []).map((p) => ({
      id: `pending:${p.id}`,
      kind: 'pending',
      refId: p.id,
      name: pendingRosterName(p),
      roster_order: p.roster_order,
      hidden_from_roster: p.hidden_from_roster,
    }))
    const all = [...staffAsItems, ...pendingAsItems].sort((a, b) => a.roster_order - b.roster_order)
    setItems(all.filter((i) => !i.hidden_from_roster))
    setHidden(all.filter((i) => i.hidden_from_roster))
    setLoading(false)
  }

  useEffect(() => {
    if (currentStoreId) load()
  }, [currentStoreId])

  function tableFor(kind) {
    return kind === 'staff' ? 'user_stores' : 'roster_pending_staff'
  }
  function matchFor(kind, refId) {
    // user_stores has no single-column primary key (profile_id, store_id)
    // is the composite key — roster_pending_staff has a plain `id`.
    return kind === 'staff' ? { profile_id: refId, store_id: currentStoreId } : { id: refId }
  }

  // Dragging can move a row several places in one go, so — same as the
  // Formula Database item lists (ItemManager.jsx) — a drop rewrites every
  // visible item's roster_order to match its new position, rather than
  // only swapping two adjacent values.
  async function persistOrder(next) {
    setItems(next)
    await Promise.all(
      next.map((it, idx) => supabase.from(tableFor(it.kind)).update({ roster_order: idx }).match(matchFor(it.kind, it.refId)))
    )
  }
  const { handleProps, rowProps } = useDragReorder(items, persistOrder)

  async function hideItem(item) {
    setBusyId(item.id)
    await supabase.from(tableFor(item.kind)).update({ hidden_from_roster: true }).match(matchFor(item.kind, item.refId))
    await load()
    setBusyId(null)
  }

  // Appended to the end of the current order rather than dropped back at
  // whatever position they used to have — that old position is stale
  // (everyone else has likely shifted since), and "goes to the bottom,
  // drag it into place" matches how a newly-added staff/Pending row would
  // behave too.
  async function restoreItem(item) {
    setBusyId(item.id)
    const nextOrder = items.length ? Math.max(...items.map((i) => i.roster_order)) + 1 : 0
    await supabase
      .from(tableFor(item.kind))
      .update({ hidden_from_roster: false, roster_order: nextOrder })
      .match(matchFor(item.kind, item.refId))
    await load()
    setBusyId(null)
  }

  if (loading) return null

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        The order staff (and Pending staff) appear in on the Manage Roster grid, and in the downloadable
        template/export — drag ⠿ to rearrange. "Remove from roster" stops someone auto-populating every week's grid
        (same as clicking ✕ next to their name in Manage Roster, just from here instead) — restore them below to
        bring them back and add them to the end of the order.
      </p>

      <h3 className="mb-2 text-sm font-semibold text-brand-700">On the roster</h3>
      {!items.length ? (
        <EmptyState label="No staff assigned to this store yet." />
      ) : (
        <div className="mb-6 divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {items.map((item) => {
            const { isDragging, isDropTarget, ...dragRowProps } = rowProps(item.id)
            return (
              <div
                key={item.id}
                {...dragRowProps}
                className={`flex items-center justify-between px-2 py-2.5 transition-colors ${
                  isDragging ? 'opacity-40' : ''
                } ${isDropTarget ? 'bg-brand-50' : ''}`}
              >
                <DragHandle {...handleProps(item.id)} />
                <span className="flex-1 text-sm font-medium text-gray-800">
                  {item.name}
                  {item.kind === 'pending' && <span className="ml-1.5 text-xs font-normal text-gray-400">Pending</span>}
                </span>
                <Button variant="secondary" disabled={busyId === item.id} onClick={() => hideItem(item)}>
                  {busyId === item.id ? '…' : 'Remove from roster'}
                </Button>
              </div>
            )
          })}
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-brand-700">Not shown on the roster</h3>
      {!hidden.length ? (
        <EmptyState label="Nobody is hidden from this store's roster." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {hidden.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-gray-600">
                {item.name}
                {item.kind === 'pending' && <span className="ml-1.5 text-xs font-normal text-gray-400">Pending</span>}
              </span>
              <Button variant="secondary" disabled={busyId === item.id} onClick={() => restoreItem(item)}>
                {busyId === item.id ? '…' : 'Restore to roster'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
