import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

const PHASE_OPTIONS = [1, 2, 3, 4, 5]
// Jeff, 2026-10-03: "新增篩選phase 1-6跟unassigned" — a quick filter above
// the list so a long Must-Know item list can be narrowed down to one phase
// (or just the still-unassigned ones) instead of scrolling the whole thing.
// Jeff, 2026-10-03 (same-day follow-up): "phase 6 的篩選移除" — Phase 6 was
// dropped from this row again — training_journey_phase only ever allows
// 1-5 (Phase 6/Master is "every item", not a specific assignment), so
// selecting it always showed an empty list and just added noise.
const FILTER_OPTIONS = ['all', 'unassigned', 1, 2, 3, 4, 5]

// Jeff, 2026-10-02 (Training Journey spec, point 5): assigns every ⭐
// Must-Know formula item (Formula Database) to one of Phase 1-5 — this is
// what TrainingJourneyPage.jsx's itemsByPhase actually reads, so until an
// item is assigned here it simply doesn't show up in anyone's Training
// Journey phase checklist and can never be part of a Level-Up Exam. An item
// marked Must-Know but left unassigned ("Pending" below) still shows up
// normally in Study Log's own Must-Know category — it's only invisible to
// Training Journey specifically, same as the comment in trainingJourney.js's
// loadTrainingJourneyData already explains. Must-Know shop training items
// are assigned the same way, but per store, from Shop Management > Training
// Centre > Training Journey Setting instead — those aren't global, so they
// can't live on this Admin Center page.
export default function PhaseItemTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('formula_items')
      .select('id, name_en, name_zh, training_journey_phase')
      .eq('is_must_know', true)
      .eq('is_active', true)
      .order('name_en')
    setItems(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  async function setPhase(item, phase) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, training_journey_phase: phase } : i)))
    await supabase.from('formula_items').update({ training_journey_phase: phase }).eq('id', item.id)
  }

  const pending = items.filter((i) => !i.training_journey_phase)
  const assigned = items.filter((i) => i.training_journey_phase).sort((a, b) => a.training_journey_phase - b.training_journey_phase)
  const filtered =
    filter === 'all' ? null : filter === 'unassigned' ? pending : items.filter((i) => i.training_journey_phase === filter)

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Every ⭐ Must-Know formula item (Formula Database), assigned to one of Phase 1–5 — this decides which
        Training Journey phase each item's checklist and Level-Up Exam question pool belongs to.
      </p>
      {loading ? null : !items.length ? (
        <EmptyState label="No Must-Know formula items yet — mark some as Must-Know in Formula Database first." />
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
            {item.name_en} {item.name_zh && <span className="font-zh text-brand-500">· {item.name_zh}</span>}
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
