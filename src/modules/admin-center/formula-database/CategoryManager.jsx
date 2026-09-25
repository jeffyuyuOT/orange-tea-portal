import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { useDragReorder, DragHandle } from '../../../lib/useDragReorder'

// Same synthetic "Top 10" category as the staff Formula page
// (operations-training/formula/FormulaPage.jsx) — not a real
// formula_categories row, so it has no Tips/Edit/Delete, just a way in to
// ItemManager's `topTen` mode (see IngredientInventoryTab.jsx).
export const TOP10_CATEGORY = { id: '__top10__', name: '⭐ Top 10' }

// Drink-group sub-categories (Fruit Tea, Milk Tea, ...): add / edit / sort /
// delete, each with its own Tips rich-text content shown in Operations &
// Training via the "Tips" button.
export default function CategoryManager({ onSelect }) {
  const [categories, setCategories] = useState([])
  const [editing, setEditing] = useState(null) // null=closed, {}=new, row=edit

  async function load() {
    const { data } = await supabase
      .from('formula_categories')
      .select('*')
      .eq('group_key', 'drink')
      .order('sort_order')
      .order('id')
    setCategories(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function persistOrder(next) {
    setCategories(next)
    await Promise.all(next.map((c, idx) => supabase.from('formula_categories').update({ sort_order: idx }).eq('id', c.id)))
  }
  const { handleProps, rowProps } = useDragReorder(categories, persistOrder)

  async function remove(id) {
    if (!confirm('Delete this category? Items inside it will be uncategorized.')) return
    await supabase.from('formula_categories').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing({})}>+ New Category</Button>
      </div>
      <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
        <div className="flex items-center px-2 py-2.5">
          <button
            onClick={() => onSelect(TOP10_CATEGORY)}
            className="flex-1 text-left font-medium text-gray-800 hover:text-brand-600"
          >
            {TOP10_CATEGORY.name}
          </button>
        </div>
        {!categories.length ? (
          <div className="px-2 py-4">
            <EmptyState label="No drink categories yet." />
          </div>
        ) : (
          categories.map((c) => {
            const { isDragging, isDropTarget, ...dragRowProps } = rowProps(c.id)
            return (
              <div
                key={c.id}
                {...dragRowProps}
                className={`flex items-center justify-between px-2 py-2.5 transition-colors ${
                  isDragging ? 'opacity-40' : ''
                } ${isDropTarget ? 'bg-brand-50' : ''}`}
              >
                <DragHandle {...handleProps(c.id)} />
                <button onClick={() => onSelect(c)} className="flex-1 text-left font-medium text-gray-800 hover:text-brand-600">
                  {c.name}
                </button>
                <div className="flex items-center gap-1">
                  <Button variant="secondary" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => remove(c.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {editing && (
        <CategoryEditModal
          category={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
          nextSortOrder={categories.length}
        />
      )}
    </div>
  )
}

function CategoryEditModal({ category, onClose, onSaved, nextSortOrder }) {
  const [name, setName] = useState(category.name ?? '')
  const [tips, setTips] = useState(category.tips_content ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    if (category.id) {
      await supabase.from('formula_categories').update({ name, tips_content: tips }).eq('id', category.id)
    } else {
      await supabase.from('formula_categories').insert({ group_key: 'drink', name, tips_content: tips, sort_order: nextSortOrder })
    }
    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={category.id ? 'Edit Category' : 'New Category'}
      footer={
        <Button onClick={save} disabled={saving || !name}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fruit Tea" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Tips content</span>
          <SimpleRichTextEditor value={tips} onChange={setTips} placeholder="Tips shown when staff tap the Tips button…" />
        </label>
      </div>
    </Modal>
  )
}
