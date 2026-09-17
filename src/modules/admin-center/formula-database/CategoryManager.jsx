import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Drink-group sub-categories (Fruit Tea, Milk Tea, ...): add / edit / sort /
// delete, each with its own Tips rich-text content shown in Operations &
// Training via the "Tips" button.
export default function CategoryManager({ onSelect }) {
  const [categories, setCategories] = useState([])
  const [editing, setEditing] = useState(null) // null=closed, {}=new, row=edit

  async function load() {
    const { data } = await supabase.from('formula_categories').select('*').eq('group_key', 'drink').order('sort_order')
    setCategories(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function move(cat, dir) {
    const idx = categories.findIndex((c) => c.id === cat.id)
    const swapWith = categories[idx + dir]
    if (!swapWith) return
    await supabase.from('formula_categories').update({ sort_order: swapWith.sort_order }).eq('id', cat.id)
    await supabase.from('formula_categories').update({ sort_order: cat.sort_order }).eq('id', swapWith.id)
    load()
  }

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
      {!categories.length ? (
        <EmptyState label="No drink categories yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {categories.map((c, idx) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-2.5">
              <button onClick={() => onSelect(c)} className="flex-1 text-left font-medium text-gray-800 hover:text-brand-600">
                {c.name}
              </button>
              <div className="flex items-center gap-1">
                <button disabled={idx === 0} onClick={() => move(c, -1)} className="px-1 text-gray-400 hover:text-brand-600 disabled:opacity-30">
                  ↑
                </button>
                <button disabled={idx === categories.length - 1} onClick={() => move(c, 1)} className="px-1 text-gray-400 hover:text-brand-600 disabled:opacity-30">
                  ↓
                </button>
                <Button variant="secondary" onClick={() => setEditing(c)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => remove(c.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

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
