import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

const PHASE_OPTIONS = [1, 2, 3, 4, 5]
// Jeff, 2026-10-03: "新增篩選phase 1-6跟unassigned" — a quick filter above
// the list so a long Must-Know item list can be narrowed down to one phase
// (or just the still-unassigned ones) instead of scrolling the whole thing.
// Jeff, 2026-10-03 (same-day follow-up): "phase 6 的篩選移除" — Phase 6 was
// dropped from this row again — training_journey_phase only ever allows
// 1-5 on the Must-Know dropdown (Phase 6/Expert and Phase 7/Master are each
// assigned a different way — see the two "Phase 6"/"Phase 7" sub-tabs
// below), so selecting Phase 6 here always showed an empty list and just
// added noise.
const FILTER_OPTIONS = ['all', 'unassigned', 1, 2, 3, 4, 5]

const VIEWS = [
  { key: 'mustknow', label: 'Must-Know Items (Phase 1–5)' },
  { key: 'phase6', label: 'Phase 6 (Expert)' },
  { key: 'phase7', label: 'Phase 7 (Master)' },
]

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
//
// Jeff, 2026-10-03 (Expert/Master split, point 2): a second sub-tab, "Phase
// 6 (Expert)", assigns NON-Must-Know formula items into Phase 6's pool —
// "must-know item assign的時候不會有phase 6選項，要增加phase 6的item都要從
// phase 6的新增item頁面" (the Must-Know dropdown above never offers Phase 6;
// the only way to add an item to Phase 6 is from this sub-tab's dedicated
// "Add Item" picker). Checking an item here sets its training_journey_phase
// to 6.
//
// Jeff, 2026-10-03 (follow-up, same day): "training journey settinge篩選增
// phase 7，邏輯跟phase 6一樣" — a third sub-tab, "Phase 7 (Master)", mirrors
// Phase 6 exactly (same non-Must-Know item pool, same Add Item flow) but
// assigns training_journey_phase = 7 instead of 6. Also per that follow-up,
// "item也只會列出還沒被assign phase的item" — the Add Item picker for BOTH
// Phase 6 and Phase 7 now only lists items with no phase assigned yet at
// all (training_journey_phase is null), not every non-Must-Know item — so
// an item can only ever land in exactly one of Phase 6 or Phase 7 (checking
// it into one removes it from the other's Add Item pool), and un-assigning
// it (✕ Remove on the main list below) is what sends it back to being
// available again. This also means Phase 6 and Phase 7 are each other's
// disjoint pool, not "Phase 7 = everything" any more — see trainingJourney.js's
// loadTrainingJourneyData for the read-side half of this change.
//
// Jeff, 2026-10-07 (migration 0093): a formula item checked "Hide from
// Formula" (Formula Database > edit item) is filtered out of every list on
// this page too, in all three sub-tabs — it reads as "removed from phase
// assign" even though its training_journey_phase value is left untouched in
// the DB, so un-hiding the item later simply makes it reappear wherever it
// already was (or still available to pick, for Phase 6/7).
export default function PhaseItemTab() {
  const [view, setView] = useState('mustknow')

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              view === v.key ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === 'mustknow' ? (
        <MustKnowPhaseList />
      ) : (
        <PhaseItemPicker phaseNumber={view === 'phase6' ? 6 : 7} phaseLabel={view === 'phase6' ? 'Phase 6 (Expert)' : 'Phase 7 (Master)'} />
      )}
    </div>
  )
}

function MustKnowPhaseList() {
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
      .eq('hide_from_formula', false)
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

// Phase 6 (Expert) / Phase 7 (Master) pool — non-Must-Know formula items
// that have been checked into this exact phase via the "+ Add Item" picker
// below. Shared between both sub-tabs (just a different `phaseNumber`).
// This list only ever shows items currently assigned to THIS phase — an
// item assigned to the other one of 6/7 (or still unassigned) doesn't show
// here; see PhaseItemTab's own comment above for why Phase 6 and Phase 7
// are disjoint now, not "Phase 7 = everything".
function PhaseItemPicker({ phaseNumber, phaseLabel }) {
  const [phaseItems, setPhaseItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('formula_items')
      .select('id, name_en, name_zh')
      .eq('is_must_know', false)
      .eq('is_active', true)
      .eq('hide_from_formula', false)
      .eq('training_journey_phase', phaseNumber)
      .order('name_en')
    setPhaseItems(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [phaseNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  async function removeFromPhase(item) {
    await supabase.from('formula_items').update({ training_journey_phase: null }).eq('id', item.id)
    load()
  }

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Items checked in here join {phaseLabel}'s item pool and X-of-Y checklist on everyone's Training Journey tab.
        Only items with no phase assigned at all show up in "+ Add Item" below — an item already in Phase 6 or
        Phase 7 isn't offered again until it's removed from whichever one it's in.
      </p>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowAdd(true)}>+ Add Item</Button>
      </div>
      {loading ? null : !phaseItems.length ? (
        <EmptyState label={`No items added to ${phaseLabel} yet — click "+ Add Item" to check some in.`} />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {phaseItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="text-sm text-gray-800">
                {item.name_en} {item.name_zh && <span className="font-zh text-brand-500">· {item.name_zh}</span>}
              </span>
              <Button variant="danger" className="px-2.5" title={`Remove from ${phaseLabel}`} aria-label={`Remove from ${phaseLabel}`} onClick={() => removeFromPhase(item)}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}
      {showAdd && (
        <AddPhaseItemModal
          phaseNumber={phaseNumber}
          phaseLabel={phaseLabel}
          onClose={() => {
            setShowAdd(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function AddPhaseItemModal({ phaseNumber, phaseLabel, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    // Jeff, 2026-10-03: only items with NO phase assigned anywhere yet —
    // once an item is checked into Phase 6 or Phase 7 it disappears from
    // this list (both of them), rather than staying listed with a checkbox
    // that could be toggled back and forth here. Removing an item from its
    // phase (✕ on the main list) is what makes it reappear.
    const { data } = await supabase
      .from('formula_items')
      .select('id, name_en, name_zh')
      .eq('is_must_know', false)
      .eq('is_active', true)
      .eq('hide_from_formula', false)
      .is('training_journey_phase', null)
      .order('name_en')
    setItems(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function add(item) {
    // Optimistically drop it from view immediately — it's no longer
    // "unassigned" the moment it's checked, so leaving it listed (even
    // checked) would be misleading.
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    await supabase.from('formula_items').update({ training_journey_phase: phaseNumber }).eq('id', item.id)
  }

  return (
    <Modal open onClose={onClose} wide title={`Add Items to ${phaseLabel}`}>
      <p className="mb-3 text-sm text-gray-500">
        Every non-Must-Know formula item not yet assigned to any phase. Check an item to add it to {phaseLabel}.
      </p>
      {loading ? null : !items.length ? (
        <EmptyState label="No unassigned items found." />
      ) : (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 border-b border-gray-100 py-1.5 text-sm text-gray-700 last:border-0">
              <input type="checkbox" onChange={(e) => e.target.checked && add(item)} />
              {item.name_en} {item.name_zh && <span className="font-zh text-brand-500">· {item.name_zh}</span>}
            </label>
          ))}
        </div>
      )}
      <Button className="mt-4 w-full" onClick={onClose}>
        Done
      </Button>
    </Modal>
  )
}
