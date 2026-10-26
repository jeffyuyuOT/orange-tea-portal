import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { rosterDisplayName } from '../../../lib/excelRoster'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import {
  MONTHS,
  brisbaneToday,
  dueInfo,
  formatDate,
  formatDayMonth,
  frequencyLabel,
  groupItems,
  isMaintenanceManager,
} from './maintenanceUtils'

// Jeff, 2026-10-26: Shop Maintenance Schedule. One row per service, one column
// per month; anyone at the store clicks a month cell, picks the date the
// service was done and confirms — the cell then shows that date and who
// recorded it. "Last schedule" = the last time the service was done in the
// previous year. A ⚠ after the service name means last-done + frequency has
// passed without it being done again; clicking it says by when it was due.
export default function MaintenanceLogPage({ logType = 'general' }) {
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? ''
  const canManage = isMaintenanceManager(profile)
  const today = brisbaneToday()

  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [items, setItems] = useState(null) // null = loading
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const [cell, setCell] = useState(null) // { item, month } being edited
  const [warn, setWarn] = useState(null) // item whose ⚠ was clicked
  const [open, setOpen] = useState(() => new Set()) // phone cards whose month dates are expanded
  const toggleOpen = (id) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const load = useCallback(async () => {
    if (!currentStoreId) return
    const [itemsRes, logsRes] = await Promise.all([
      supabase.from('maintenance_items').select('*').eq('store_id', currentStoreId).order('sort_order'),
      supabase.from('maintenance_logs').select('*').eq('store_id', currentStoreId).order('done_date'),
    ])
    const err = itemsRes.error || logsRes.error
    if (err) setError(err.message)
    setItems(itemsRes.data ?? [])
    setLogs(logsRes.data ?? [])
  }, [currentStoreId])

  useEffect(() => {
    setItems(null)
    setCell(null)
    setWarn(null)
    setError('')
    load()
  }, [load])

  const rows = useMemo(() => groupItems((items ?? []).filter((i) => (i.log_type ?? 'general') === 'both' || (i.log_type ?? 'general') === logType)), [items, logType])

  // item_id -> month index -> entries that month (selected year)
  const byCell = useMemo(() => {
    const map = new Map()
    for (const l of logs) {
      if (Number(l.done_date.slice(0, 4)) !== year) continue
      const key = `${l.item_id}:${Number(l.done_date.slice(5, 7)) - 1}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(l)
    }
    return map
  }, [logs, year])

  // item_id -> the most recent date done BEFORE the selected year (so a
  // service last done in 2024 still shows as 2026's "last schedule" if it
  // wasn't done in 2025).
  const lastYear = useMemo(() => {
    const map = new Map()
    for (const l of logs) {
      if (Number(l.done_date.slice(0, 4)) >= year) continue
      if (!map.has(l.item_id) || l.done_date > map.get(l.item_id)) map.set(l.item_id, l.done_date)
    }
    return map
  }, [logs, year])

  if (!currentStoreId) return <EmptyState label="Choose a store first." />

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {storeName && <span className="font-medium text-gray-800">{storeName}</span>} · Click a month to record the date a service was done.
        </p>
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <button className="rounded px-2 py-1 hover:bg-brand-50" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
            ‹
          </button>
          Year {year}
          <button className="rounded px-2 py-1 hover:bg-brand-50" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
            ›
          </button>
        </div>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {items === null ? (
        <LoadingSpinner />
      ) : !rows.length ? (
        <EmptyState label={logType === 'manager' ? "No Manager's Log items for this store yet. Add them in Setting." : 'No maintenance items for this store yet.'} />
      ) : (
        <>
        {/* Phone: one card per service with a 4x3 month grid — no sideways scrolling. */}
        <div className="space-y-3 md:hidden">
          {rows.map((r) => {
            if (r.type === 'category') {
              return (
                <div key={`mcat-${r.name}`} className="rounded-lg border-l-4 border-l-brand-500 bg-brand-100 px-3 py-2 text-sm font-bold text-brand-800">
                  {r.name}
                </div>
              )
            }
            const it = r.item
            const info = dueInfo(it, logs, today)
            const last = lastYear.get(it.id)
            const isOpen = open.has(it.id)
            const doneCount = MONTHS.reduce((n, _m, mi) => n + (byCell.get(`${it.id}:${mi}`)?.length ?? 0), 0)
            return (
              <div key={it.id} className="rounded-xl border border-brand-100 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm font-semibold text-gray-900">
                    {it.name}
                    {info.overdue && (
                      <button onClick={() => setWarn(it)} className="ml-1.5 text-amber-500" aria-label="Overdue">
                        ⚠️
                      </button>
                    )}
                  </div>
                  <div className="shrink-0 text-xs text-gray-500">{frequencyLabel(it.frequency_months)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleOpen(it.id)}
                  aria-expanded={isOpen}
                  className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg bg-brand-50 px-2.5 py-1.5 text-left text-xs text-gray-600"
                >
                  <span>
                    Last schedule: {last ? formatDate(last) : '—'}
                    <span className="ml-2 text-brand-700">· {doneCount} in {year}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-medium text-brand-700">
                    {isOpen ? 'Hide dates' : 'Dates'}
                    <svg className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {MONTHS.map((m, mi) => {
                      const entries = byCell.get(`${it.id}:${mi}`) ?? []
                      return (
                        <button
                          key={m}
                          onClick={() => setCell({ item: it, month: mi })}
                          className={`min-h-[52px] rounded-lg border px-1 py-1 text-center ${
                            entries.length ? 'border-green-200 bg-green-50' : 'border-brand-100 bg-white'
                          }`}
                          aria-label={`${it.name} ${m}`}
                        >
                          <span className="block text-[10px] font-semibold uppercase text-gray-400">{m}</span>
                          {entries.length === 0 ? (
                            <span className="block text-gray-300">+</span>
                          ) : (
                            entries.map((e) => (
                              <span key={e.id} className="block leading-tight">
                                <span className="block text-xs font-medium text-green-700">{formatDayMonth(e.done_date)}</span>
                                <span className="block truncate text-[10px] text-gray-500">{e.done_by_name}</span>
                              </span>
                            ))
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-brand-100 bg-white md:block">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="bg-brand-50 text-xs font-semibold uppercase tracking-wide text-brand-700">
                <th className="sticky left-0 z-10 min-w-[220px] border-b border-r border-brand-100 bg-brand-50 px-3 py-2 text-left">Item</th>
                <th className="border-b border-r border-brand-100 px-3 py-2 text-left">Frequency</th>
                <th className="border-b border-r border-brand-100 px-3 py-2 text-left">Last schedule</th>
                {MONTHS.map((m) => (
                  <th key={m} className="min-w-[78px] border-b border-r border-brand-100 px-2 py-2 text-center last:border-r-0">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                if (r.type === 'category') {
                  return (
                    <tr key={`cat-${r.name}`}>
                      <td colSpan={15} className="sticky left-0 border-b border-l-4 border-b-brand-200 border-l-brand-500 bg-brand-100 px-3 py-2 font-bold text-brand-800">
                        {r.name}
                      </td>
                    </tr>
                  )
                }
                const it = r.item
                const info = dueInfo(it, logs, today)
                const last = lastYear.get(it.id)
                return (
                  <tr key={it.id} className="border-b border-brand-100 align-top">
                    <td className="sticky left-0 z-10 border-r border-brand-100 bg-white px-3 py-2 font-medium text-gray-900">
                      {it.name}
                      {info.overdue && (
                        <button
                          onClick={() => setWarn(it)}
                          className="ml-1.5 text-amber-500 hover:text-amber-600"
                          title="Overdue — click for details"
                          aria-label="Overdue"
                        >
                          ⚠️
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap border-r border-brand-100 px-3 py-2 text-gray-600">{frequencyLabel(it.frequency_months)}</td>
                    <td className="whitespace-nowrap border-r border-brand-100 px-3 py-2 text-gray-600">{last ? formatDate(last) : '—'}</td>
                    {MONTHS.map((_, mi) => {
                      const entries = byCell.get(`${it.id}:${mi}`) ?? []
                      return (
                        <td key={mi} className="border-r border-brand-100 p-0 last:border-r-0">
                          <button
                            onClick={() => setCell({ item: it, month: mi })}
                            className={`block h-full min-h-[44px] w-full px-1.5 py-1.5 text-center hover:bg-brand-50 ${entries.length ? '' : 'text-gray-200'}`}
                            aria-label={`${it.name} ${MONTHS[mi]}`}
                          >
                            {entries.length === 0 ? (
                              '+'
                            ) : (
                              entries.map((e) => (
                                <span key={e.id} className="block leading-tight">
                                  <span className="block text-xs font-medium text-green-700">{formatDayMonth(e.done_date)}</span>
                                  <span className="block truncate text-[11px] text-gray-500" title={e.done_by_name}>
                                    {e.done_by_name}
                                  </span>
                                </span>
                              ))
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {cell && (
        <RecordModal
          key={`${cell.item.id}-${cell.month}`}
          item={cell.item}
          month={cell.month}
          year={year}
          today={today}
          entries={byCell.get(`${cell.item.id}:${cell.month}`) ?? []}
          profile={profile}
          canManage={canManage}
          storeId={currentStoreId}
          onClose={() => setCell(null)}
          onChanged={load}
        />
      )}

      <Modal
        open={!!warn}
        onClose={() => setWarn(null)}
        title="Maintenance overdue"
        footer={<Button onClick={() => setWarn(null)}>Close</Button>}
      >
        {warn &&
          (() => {
            const info = dueInfo(warn, logs, today)
            return (
              <div className="space-y-2 text-sm text-gray-700">
                <p>
                  <span className="font-semibold">{warn.name}</span> ({frequencyLabel(warn.frequency_months)}) should have been completed by{' '}
                  <span className="font-semibold text-red-700">{formatDate(info.due)}</span>.
                </p>
                <p className="text-gray-500">
                  {info.neverDone
                    ? `It has not been recorded yet — counted from when it was added to this list.`
                    : `Last done on ${formatDate(info.last)}.`}
                </p>
              </div>
            )
          })()}
      </Modal>
    </div>
  )
}

function RecordModal({ item, month, year, today, entries, profile, canManage, storeId, onClose, onChanged }) {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDay = new Date(year, month + 1, 0).getDate()
  const last = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const [date, setDate] = useState(today >= first && today <= last ? today : first)
  const [error, setError] = useState('')

  async function confirm() {
    if (!date || date < first || date > last) return
    setError('')
    const { error: err } = await supabase.from('maintenance_logs').insert({
      store_id: storeId,
      item_id: item.id,
      done_date: date,
      done_by: profile.id,
      done_by_name: rosterDisplayName(profile) || profile.email || 'Unknown',
    })
    if (err) return setError(err.message)
    await onChanged()
    onClose()
  }

  async function remove(entry) {
    if (!window.confirm(`Remove the entry for ${formatDate(entry.done_date)}?`)) return
    setError('')
    const { error: err } = await supabase.from('maintenance_logs').delete().eq('id', entry.id)
    if (err) return setError(err.message)
    await onChanged()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${item.name} — ${MONTHS[month]} ${year}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!date || date < first || date > last}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {entries.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-medium text-gray-700">Already recorded</div>
            <div className="divide-y divide-brand-100 rounded-lg border border-brand-100">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium text-gray-800">{formatDate(e.done_date)}</span>
                  <span className="text-gray-500">by {e.done_by_name}</span>
                  {(canManage || e.done_by === profile.id) && (
                    <button className="ml-auto text-xs font-medium text-red-600 hover:text-red-800" onClick={() => remove(e)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Date the service was done</label>
          <input type="date" className="input !w-auto" min={first} max={last} value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="mt-1 text-xs text-gray-400">
            Recorded under your name ({rosterDisplayName(profile) || profile.email}).
          </p>
        </div>
      </div>
    </Modal>
  )
}
