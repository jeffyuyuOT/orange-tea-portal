import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabaseClient'
import { useAuth } from '../../../../lib/AuthContext'
import { EmptyState } from '../../../../components/ui/LoadingSpinner'

const PHASE_OPTIONS = [1, 2, 3, 4, 5]
// Jeff, 2026-10-03: same filter row added to Admin Center's Phase Item tab
// (PhaseItemTab.jsx) — see its comment for why Phase 6 is included even
// though no item can actually be assigned it.
const FILTER_OPTIONS = ['all', 'unassigned', 1, 2, 3, 4, 5, 6]

// Jeff, 2026-10-02 (Training Journey spec, point 5): the shop-level half of
// Training Journey Setting — assigns THIS store's own ⭐ Must-Know shop
// training items (Training Centre > Shop Training Database) to Phase 1-5,
// same role Admin Center's "Phase Item" tab plays for (global) Must-Know
// formula items, but per store since shop_training_items isn't global. No
// own <h1> — renders under TrainingCentreLayout's shared heading + tab bar,
// same as this bar's other three tabs. Switch stores (header picker) to
// edit another store's assignments.
export default function TrainingJourneySettingPage() {
  const { currentStoreId } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  async function load() {
    if (!currentStoreId) return
    setLoading(true)
    const { data } = await supabase
      .from('shop_training_items')
      .select('id, title, training_journey_phase')
      .eq('store_id', currentStoreId)
      .eq('is_must_know', true)
      .order('title')
    setItems(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [currentStoreId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setPhase(item, phase) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, training_journey_phase: phase } : i)))
    await supabase.from('shop_training_items').update({ training_journey_phase: phase }).eq('id', item.id)
  }

  const pending = items.filter((i) => !i.training_journey_phase)
  const assigned = items.filter((i) => i.training_journey_phase).sort((a, b) => a.training_journey_phase - b.training_journey_phase)
  const filtered =
    filter === 'all' ? null : filter === 'unassigned' ? pending : items.filter((i) => i.training_journey_phase === filter)

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        This store's own ⭐ Must-Know shop training items (Shop Training Database), assigned to one of Phase 1–5 —
        same role as Admin Center's Training Journey Setting plays for Must-Know formula items. Switch stores above
        to edit another store's assignments.
      </p>
      {loading ? null : !items.length ? (
        <EmptyState label="No Must-Know shop training items yet for this store — mark some as Must-Know in Shop Training Database first." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  filter === f ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {f === 'all' ? 'All' : f === 'unassigned' ? 'Unassigned' : `Phase ${f}`}
              </button>
            ))}
          </div>

          {filter === 'all' ? (
            <div className="space-y-5">
              {pending.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                    Pending — not yet assigned to a phase ({pending.length})
                  </h3>
                  <ItemList items={pending} onChange={setPhase} />
                </section>
              )}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Assigned</h3>
                {assigned.length ? (
                  <ItemList items={assigned} onChange={setPhase} showPhase />
                ) : (
                  <p className="text-sm text-gray-400">None assigned yet.</p>
                )}
              </section>
            </div>
          ) : filtered.length ? (
            <ItemList items={filtered} onChange={setPhase} showPhase={filter !== 'unassigned'} />
          ) : (
            <p className="text-sm text-gray-400">
              {filter === 'unassigned' ? 'Nothing pending — every item is assigned.' : 'No items in this phase.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ItemList({ items, onChange, showPhase }) {
  return (
    <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
          <span className="text-sm text-gray-800">
            {showPhase && <span className="mr-2 text-xs font-semibold text-brand-500">P{item.training_journey_phase}</span>}
            {item.title}
          </span>
          <select
            className="input !w-auto"
            value={item.training_journey_phase ?? ''}
            onChange={(e) => onChange(item, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— Unassigned —</option>
            {PHASE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                Phase {p}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}
