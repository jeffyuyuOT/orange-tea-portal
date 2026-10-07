import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabaseClient'
import { useAuth } from '../../../../lib/AuthContext'
import { EmptyState } from '../../../../components/ui/LoadingSpinner'
import Modal from '../../../../components/ui/Modal'
import Button from '../../../../components/ui/Button'

const PHASE_OPTIONS = [1, 2, 3]
// Jeff, 2026-10-03: same filter row added to Admin Center's Phase Item tab
// (PhaseItemTab.jsx) — see its comment. Phase 4 isn't in this row either;
// it has its own sub-tab below, same as Admin Center's.
const FILTER_OPTIONS = ['all', 'unassigned', 1, 2, 3]

const VIEWS = [
  { key: 'mustknow', label: 'Must-Know Items (Phase 1–3)' },
  { key: 'phase4', label: 'Phase 4 (Master)' },
]

// Jeff, 2026-10-02 (Training Journey spec, point 5; phase-merge, 2026-10-07,
// point 1): the shop-level half of Training Journey Setting — assigns THIS
// store's own ⭐ Must-Know shop training items (Training Centre > Shop
// Training Database) to Phase 1-3, same role Admin Center's "Phase Item"
// tab plays for (global) Must-Know formula items, but per store since
// shop_training_items isn't global. No own <h1> — renders under
// TrainingCentreLayout's shared heading + tab bar, same as this bar's other
// three tabs. Switch stores (header picker) to edit another store's
// assignments.
//
// A second sub-tab, "Phase 4 (Master)", mirrors Admin Center's
// PhaseItemTab.jsx exactly — assigns NON-Must-Know shop training items
// (this store's) into Phase 4's pool via a dedicated "Add Item" picker that
// only ever offers items not yet assigned to any phase; the Must-Know
// dropdown above never offers Phase 4. See that file's comment for the
// full rationale — identical here, just scoped to `currentStoreId`.
export default function TrainingJourneySettingPage() {
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
      {view === 'mustknow' ? <MustKnowPhaseList /> : <PhaseItemPicker phaseNumber={4} phaseLabel="Phase 4 (Master)" />}
    </div>
  )
}

function MustKnowPhaseList() {
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
        This store's own ⭐ Must-Know shop training items (Shop Training Database), assigned to one of Phase 1–3 —
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

// Phase 4 (Master) pool for this store — non-Must-Know shop training items
// that have been checked into Phase 4 via the "+ Add Item" picker below.
// Mirrors PhaseItemTab.jsx's PhaseItemPicker exactly, scoped to
// currentStoreId.
function PhaseItemPicker({ phaseNumber, phaseLabel }) {
  const { currentStoreId } = useAuth()
  const [phaseItems, setPhaseItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  async function load() {
    if (!currentStoreId) return
    setLoading(true)
    const { data } = await supabase
      .from('shop_training_items')
      .select('id, title')
      .eq('store_id', currentStoreId)
      .eq('is_must_know', false)
      .eq('training_journey_phase', phaseNumber)
      .order('title')
    setPhaseItems(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [currentStoreId, phaseNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  async function removeFromPhase(item) {
    await supabase.from('shop_training_items').update({ training_journey_phase: null }).eq('id', item.id)
    load()
  }

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Items checked in here join {phaseLabel}'s item pool and X-of-Y checklist for this store, on everyone's
        Training Journey tab. Only items with no phase assigned at all show up in "+ Add Item" below. Switch
        stores above to edit another store's Phase 4 items.
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
              <span className="text-sm text-gray-800">{item.title}</span>
              <Button variant="danger" className="px-2.5" title={`Remove from ${phaseLabel}`} aria-label={`Remove from ${phaseLabel}`} onClick={() => removeFromPhase(item)}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}
      {showAdd && (
        <AddPhaseItemModal
          storeId={currentStoreId}
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

function AddPhaseItemModal({ storeId, phaseNumber, phaseLabel, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!storeId) return
    setLoading(true)
    // Jeff, 2026-10-03: only items with NO phase assigned anywhere yet —
    // once an item is checked into Phase 4 it disappears from this list,
    // rather than staying listed with a checkbox that could be toggled back
    // and forth here. Removing an item from its phase (✕ on the main list)
    // is what makes it reappear.
    const { data } = await supabase
      .from('shop_training_items')
      .select('id, title')
      .eq('store_id', storeId)
      .eq('is_must_know', false)
      .is('training_journey_phase', null)
      .order('title')
    setItems(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])

  async function add(item) {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    await supabase.from('shop_training_items').update({ training_journey_phase: phaseNumber }).eq('id', item.id)
  }

  return (
    <Modal open onClose={onClose} wide title={`Add Items to ${phaseLabel}`}>
      <p className="mb-3 text-sm text-gray-500">
        Every non-Must-Know shop training item for this store not yet assigned to any phase. Check an item to add
        it to {phaseLabel}.
      </p>
      {loading ? null : !items.length ? (
        <EmptyState label="No unassigned items found." />
      ) : (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 border-b border-gray-100 py-1.5 text-sm text-gray-700 last:border-0">
              <input type="checkbox" onChange={(e) => e.target.checked && add(item)} />
              {item.title}
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
