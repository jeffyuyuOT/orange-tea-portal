import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Button from '../../../components/ui/Button'
import FormulaItemDetail from '../../operations-training/formula/FormulaItemDetail'

// Same top-level formula classification used in Operations & Training >
// Formula (FormulaPage.jsx) — kept in sync with GROUPS there.
const GROUPS = [
  { key: 'drink', label: 'Drink' },
  { key: 'tea', label: 'Tea' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'others', label: 'Others' },
]

// Shared between "My Dashboard > Study Log" (own progress) and
// "Shop Management > Learning Tracker" (a manager/admin viewing + bulk
// editing someone else's progress, per the spec's "admin可支援批量選取").
//
// `senior`: a manager-flagged "senior" staff member is treated as having
// every item memorized automatically (including items added later) — the
// checkboxes render checked-and-locked rather than reflecting individual
// study_progress rows.
// `onProgressChange`: fired after a (non-senior) toggle persists, so a
// parent tracking overall memorized % (e.g. the forced-quiz-every-10%
// check in StudyLogPage) can re-evaluate immediately.
export default function StudyLogList({ profileId, allowBulkSelect = false, senior = false, onProgressChange }) {
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([]) // drink-group sub-categories, for the filter dropdown
  const [progress, setProgress] = useState({}) // formula_item_id -> row
  const [loading, setLoading] = useState(true)
  const [openItem, setOpenItem] = useState(null)
  const [group, setGroup] = useState('drink')
  const [categoryId, setCategoryId] = useState(null) // null = "All categories" within the drink group

  async function load() {
    setLoading(true)
    const [{ data: itemRows }, { data: progressRows }, { data: categoryRows }] = await Promise.all([
      supabase
        .from('formula_items')
        .select('*, formula_categories(name)')
        .eq('is_active', true)
        .order('group_key')
        .order('sort_order'),
      supabase.from('study_progress').select('*').eq('profile_id', profileId),
      supabase.from('formula_categories').select('*').eq('group_key', 'drink').order('sort_order').order('id'),
    ])
    setItems(itemRows ?? [])
    setCategories(categoryRows ?? [])
    const map = {}
    ;(progressRows ?? []).forEach((p) => (map[p.formula_item_id] = p))
    setProgress(map)
    setLoading(false)
  }

  useEffect(() => {
    if (profileId) load()
  }, [profileId])

  function selectGroup(key) {
    setGroup(key)
    setCategoryId(null)
  }

  const filteredItems = useMemo(
    () =>
      items.filter(
        (i) => i.group_key === group && (group !== 'drink' || !categoryId || i.category_id === categoryId)
      ),
    [items, group, categoryId]
  )

  async function toggle(itemId, value) {
    if (senior) return // locked — senior status covers every item automatically
    setProgress((prev) => ({ ...prev, [itemId]: { ...prev[itemId], memorized: value } }))
    await supabase.from('study_progress').upsert(
      {
        profile_id: profileId,
        formula_item_id: itemId,
        memorized: value,
        memorized_at: value ? new Date().toISOString() : null,
      },
      { onConflict: 'profile_id,formula_item_id' }
    )
    onProgressChange?.()
  }

  async function bulkSet(value) {
    await Promise.all(filteredItems.map((i) => toggle(i.id, value)))
  }

  if (loading) return <LoadingSpinner />
  if (!items.length) return <EmptyState label="No formula items to study yet." />

  const memorizedCount = senior ? filteredItems.length : filteredItems.filter((i) => progress[i.id]?.memorized).length

  return (
    <div>
      <div className="mb-3 flex gap-1 border-b border-brand-100">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => selectGroup(g.key)}
            className={`px-4 py-2 text-sm font-medium ${
              group === g.key ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {group === 'drink' && (
            <select
              className="input w-auto"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value || null)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <p className="text-sm text-gray-500">
            {memorizedCount} of {filteredItems.length} memorized
          </p>
          {senior && <span className="text-xs font-medium text-brand-500">Senior — all items auto-memorized</span>}
        </div>
        {allowBulkSelect && !senior && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => bulkSet(true)}>
              Mark all memorized
            </Button>
            <Button variant="secondary" onClick={() => bulkSet(false)}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      {!filteredItems.length ? (
        <EmptyState label="No items in this category yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {filteredItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
              <button onClick={() => setOpenItem(item)} className="flex-1 text-left">
                {item.formula_categories && (
                  <span className="text-xs text-brand-400">{item.formula_categories.name}</span>
                )}
                <div className="font-medium text-gray-800">
                  {item.name_en} {item.name_zh && <span className="font-zh text-brand-600">· {item.name_zh}</span>}
                </div>
              </button>
              <label className="flex items-center gap-2 text-sm text-gray-500">
                Memorized
                <input
                  type="checkbox"
                  checked={senior || !!progress[item.id]?.memorized}
                  disabled={senior}
                  onChange={(e) => toggle(item.id, e.target.checked)}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <FormulaItemDetail item={openItem} onClose={() => setOpenItem(null)} />
    </div>
  )
}
