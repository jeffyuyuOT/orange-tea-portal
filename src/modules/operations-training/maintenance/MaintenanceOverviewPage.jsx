import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Badge from '../../../components/ui/Badge'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { brisbaneToday, dueInfo, formatDate, frequencyLabel } from './maintenanceUtils'

const LOG_LABEL = { general: 'Log', manager: "Manager's Log", both: 'Both' }

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000)
}

// Jeff, 2026-10-26: admin/developer cross-store overview of the Maintenance
// Log — one table of every store's services (overdue by default), filtered by
// whichever stores are ticked.
export default function MaintenanceOverviewPage() {
  const { accessibleStores } = useAuth()
  const today = brisbaneToday()

  const [items, setItems] = useState(null) // null = loading
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null) // Set of store ids; null until stores known
  const [overdueOnly, setOverdueOnly] = useState(true)

  useEffect(() => {
    if (selected === null && accessibleStores.length) setSelected(new Set(accessibleStores.map((s) => s.id)))
  }, [accessibleStores, selected])

  const load = useCallback(async () => {
    const [itemsRes, logsRes] = await Promise.all([
      supabase.from('maintenance_items').select('*').order('sort_order'),
      supabase.from('maintenance_logs').select('item_id, done_date'),
    ])
    const err = itemsRes.error || logsRes.error
    if (err) setError(err.message)
    setItems(itemsRes.data ?? [])
    setLogs(logsRes.data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const sel = selected ?? new Set()

  // One computed row per item, for the ticked stores only.
  const rows = useMemo(() => {
    return (items ?? [])
      .filter((it) => sel.has(it.store_id))
      .map((it) => {
        const info = dueInfo(it, logs, today)
        return { it, info, daysOver: info.overdue ? daysBetween(info.due, today) : 0, daysLeft: daysBetween(today, info.due) }
      })
  }, [items, logs, sel, today])

  const shownByStore = useMemo(() => {
    const out = []
    for (const s of accessibleStores) {
      if (!sel.has(s.id)) continue
      const all = rows.filter((r) => r.it.store_id === s.id)
      const list = (overdueOnly ? all.filter((r) => r.info.overdue) : all).sort((a, b) => b.daysOver - a.daysOver || a.daysLeft - b.daysLeft)
      out.push({ store: s, list, overdueCount: all.filter((r) => r.info.overdue).length, total: all.length })
    }
    return out
  }, [rows, accessibleStores, sel, overdueOnly])

  function toggle(id) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const totalOverdue = shownByStore.reduce((n, g) => n + g.overdueCount, 0)

  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">Overdue maintenance across stores. Tick the stores to include.</p>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-brand-100 bg-white px-4 py-3">
        {accessibleStores.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
            {s.name}
          </label>
        ))}
        <button
          className="text-xs font-medium text-brand-600 hover:text-brand-800"
          onClick={() => setSelected(sel.size === accessibleStores.length ? new Set() : new Set(accessibleStores.map((s) => s.id)))}
        >
          {sel.size === accessibleStores.length ? 'Clear all' : 'Select all'}
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
      </div>

      {items === null ? (
        <LoadingSpinner />
      ) : !sel.size ? (
        <EmptyState label="Tick at least one store." />
      ) : (
        <>
          <div className="mb-2 text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{totalOverdue}</span> overdue service{totalOverdue === 1 ? '' : 's'} in {sel.size} store
            {sel.size === 1 ? '' : 's'}.
          </div>
          {/* Phone: cards grouped by store, no sideways scrolling. */}
          <div className="space-y-3 md:hidden">
            {shownByStore.map((g) => (
              <div key={g.store.id}>
                <div className="rounded-lg border-l-4 border-l-brand-500 bg-brand-100 px-3 py-2 font-bold text-brand-800">
                  {g.store.name}
                  <span className="ml-2 text-xs font-medium text-brand-700">
                    {g.overdueCount} overdue · {g.total} service{g.total === 1 ? '' : 's'}
                  </span>
                </div>
                {g.list.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-gray-400">
                    {g.total === 0 ? 'No maintenance items set up.' : overdueOnly ? 'Nothing overdue. ✓' : 'No items.'}
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {g.list.map(({ it, info, daysOver, daysLeft }) => (
                      <div key={it.id} className="rounded-xl border border-brand-100 bg-white p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-semibold text-gray-900">{it.name}</div>
                          <div className="shrink-0">
                            {info.overdue ? (
                              <Badge color="red">⚠️ {daysOver}d overdue</Badge>
                            ) : daysLeft <= 7 ? (
                              <Badge color="gray">Due in {daysLeft}d</Badge>
                            ) : (
                              <span className="text-xs text-green-700">OK</span>
                            )}
                          </div>
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {[it.category, LOG_LABEL[it.log_type ?? 'general'], frequencyLabel(it.frequency_months)].filter(Boolean).join(' · ')}
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          Last done: {info.last ? formatDate(info.last) : 'Never'} · Due by: <span className="font-medium">{formatDate(info.due)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-brand-100 bg-white md:block">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="bg-brand-50 text-xs font-semibold uppercase tracking-wide text-brand-700">
                  <th className="border-b border-brand-100 px-3 py-2 text-left">Service</th>
                  <th className="border-b border-brand-100 px-3 py-2 text-left">Category</th>
                  <th className="border-b border-brand-100 px-3 py-2 text-left">Appears in</th>
                  <th className="border-b border-brand-100 px-3 py-2 text-left">Frequency</th>
                  <th className="border-b border-brand-100 px-3 py-2 text-left">Last done</th>
                  <th className="border-b border-brand-100 px-3 py-2 text-left">Due by</th>
                  <th className="border-b border-brand-100 px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {shownByStore.map((g) => (
                  <StoreGroup key={g.store.id} g={g} overdueOnly={overdueOnly} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function StoreGroup({ g, overdueOnly }) {
  return (
    <>
      <tr>
        <td colSpan={7} className="border-b border-l-4 border-b-brand-200 border-l-brand-500 bg-brand-100 px-3 py-2 font-bold text-brand-800">
          {g.store.name}
          <span className="ml-2 text-xs font-medium text-brand-700">
            {g.overdueCount} overdue · {g.total} service{g.total === 1 ? '' : 's'}
          </span>
        </td>
      </tr>
      {g.list.length === 0 ? (
        <tr>
          <td colSpan={7} className="border-b border-brand-100 px-3 py-3 text-gray-400">
            {g.total === 0 ? 'No maintenance items set up.' : overdueOnly ? 'Nothing overdue. ✓' : 'No items.'}
          </td>
        </tr>
      ) : (
        g.list.map(({ it, info, daysOver, daysLeft }) => (
          <tr key={it.id} className="border-b border-brand-100">
            <td className="px-3 py-2 font-medium text-gray-900">{it.name}</td>
            <td className="px-3 py-2 text-gray-600">{it.category || '—'}</td>
            <td className="px-3 py-2 text-gray-600">{LOG_LABEL[it.log_type ?? 'general']}</td>
            <td className="whitespace-nowrap px-3 py-2 text-gray-600">{frequencyLabel(it.frequency_months)}</td>
            <td className="whitespace-nowrap px-3 py-2 text-gray-600">{info.last ? formatDate(info.last) : 'Never'}</td>
            <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(info.due)}</td>
            <td className="whitespace-nowrap px-3 py-2">
              {info.overdue ? (
                <Badge color="red">
                  ⚠️ {daysOver} day{daysOver === 1 ? '' : 's'} overdue
                </Badge>
              ) : daysLeft <= 7 ? (
                <Badge color="gray">Due in {daysLeft} day{daysLeft === 1 ? '' : 's'}</Badge>
              ) : (
                <span className="text-green-700">OK</span>
              )}
            </td>
          </tr>
        ))
      )}
    </>
  )
}
