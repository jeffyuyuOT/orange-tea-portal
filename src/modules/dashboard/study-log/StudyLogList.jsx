import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Button from '../../../components/ui/Button'
import FormulaItemDetail from '../../operations-training/formula/FormulaItemDetail'

const GROUP_LABELS = { drink: 'Drink', tea: 'Tea', toppings: 'Toppings', others: 'Others' }

// Shared between "My Dashboard > Study Log" (own progress) and
// "Shop Management > Learning Tracker" (a manager/admin viewing + bulk
// editing someone else's progress, per the spec's "admin可支援批量選取").
export default function StudyLogList({ profileId, allowBulkSelect = false }) {
  const [items, setItems] = useState([])
  const [progress, setProgress] = useState({}) // formula_item_id -> row
  const [loading, setLoading] = useState(true)
  const [openItem, setOpenItem] = useState(null)

  async function load() {
    setLoading(true)
    const { data: itemRows } = await supabase
      .from('formula_items')
      .select('*, formula_categories(name)')
      .eq('is_active', true)
      .order('group_key')
      .order('sort_order')
    const { data: progressRows } = await supabase.from('study_progress').select('*').eq('profile_id', profileId)
    setItems(itemRows ?? [])
    const map = {}
    ;(progressRows ?? []).forEach((p) => (map[p.formula_item_id] = p))
    setProgress(map)
    setLoading(false)
  }

  useEffect(() => {
    if (profileId) load()
  }, [profileId])

  async function toggle(itemId, value) {
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
  }

  async function bulkSet(value) {
    await Promise.all(items.map((i) => toggle(i.id, value)))
  }

  if (loading) return <LoadingSpinner />
  if (!items.length) return <EmptyState label="No formula items to study yet." />

  const memorizedCount = items.filter((i) => progress[i.id]?.memorized).length

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {memorizedCount} of {items.length} memorized
        </p>
        {allowBulkSelect && (
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

      <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
            <button onClick={() => setOpenItem(item)} className="flex-1 text-left">
              <span className="text-xs text-brand-400">
                {GROUP_LABELS[item.group_key]}
                {item.formula_categories ? ` · ${item.formula_categories.name}` : ''}
              </span>
              <div className="font-medium text-gray-800">
                {item.name_en} {item.name_zh && <span className="font-zh text-brand-600">· {item.name_zh}</span>}
              </div>
            </button>
            <label className="flex items-center gap-2 text-sm text-gray-500">
              Memorized
              <input
                type="checkbox"
                checked={!!progress[item.id]?.memorized}
                onChange={(e) => toggle(item.id, e.target.checked)}
              />
            </label>
          </div>
        ))}
      </div>

      <FormulaItemDetail item={openItem} onClose={() => setOpenItem(null)} />
    </div>
  )
}
