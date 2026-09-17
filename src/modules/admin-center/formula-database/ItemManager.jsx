import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import ItemEditModal from './ItemEditModal'

// Lists formula_items for a given group (+ optional category), with
// add / sort / edit — used for Drink items inside a category, and for the
// flat Tea / Toppings / Others lists.
export default function ItemManager({ groupKey, categoryId, onBack, backLabel }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)

  async function load() {
    let q = supabase.from('formula_items').select('*').eq('group_key', groupKey)
    q = categoryId ? q.eq('category_id', categoryId) : q.is('category_id', null)
    const { data } = await q.order('sort_order')
    setItems(data ?? [])
  }
  useEffect(() => {
    load()
  }, [groupKey, categoryId])

  async function move(item, dir) {
    const idx = items.findIndex((i) => i.id === item.id)
    const swapWith = items[idx + dir]
    if (!swapWith) return
    await supabase.from('formula_items').update({ sort_order: swapWith.sort_order }).eq('id', item.id)
    await supabase.from('formula_items').update({ sort_order: item.sort_order }).eq('id', swapWith.id)
    load()
  }

  async function remove(id) {
    if (!confirm('Delete this item and its formula/steps?')) return
    await supabase.from('formula_items').delete().eq('id', id)
    load()
  }

  return (
    <div>
      {onBack && (
        <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-600 hover:underline">
          {backLabel}
        </button>
      )}
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing({ group_key: groupKey, category_id: categoryId })}>+ New Item</Button>
      </div>
      {!items.length ? (
        <EmptyState label="No items yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {items.map((item, idx) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
              <button onClick={() => setEditing(item)} className="flex-1 text-left font-medium text-gray-800 hover:text-brand-600">
                {item.name_en} {item.name_zh && <span className="font-zh text-brand-500">· {item.name_zh}</span>}
              </button>
              <div className="flex items-center gap-1">
                <button disabled={idx === 0} onClick={() => move(item, -1)} className="px-1 text-gray-400 hover:text-brand-600 disabled:opacity-30">
                  ↑
                </button>
                <button disabled={idx === items.length - 1} onClick={() => move(item, 1)} className="px-1 text-gray-400 hover:text-brand-600 disabled:opacity-30">
                  ↓
                </button>
                <Button variant="danger" onClick={() => remove(item.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ItemEditModal
          item={editing}
          nextSortOrder={items.length}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}
