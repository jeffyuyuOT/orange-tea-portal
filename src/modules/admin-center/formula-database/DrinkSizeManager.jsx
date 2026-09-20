import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { useDragReorder, DragHandle } from '../../../lib/useDragReorder'

// Global list of drink sizes (e.g. M / L / XL). Drink items opt into
// whichever of these they offer from their own Edit Item screen, where
// each selected size gets its own ingredient list.
//
// No hard-delete here: formula_item_ingredients.size_id and
// formula_item_sizes.size_id both reference drink_sizes with
// ON DELETE CASCADE, so removing a size would silently wipe every drink's
// ingredient list for that size across the whole menu. Rename a size
// instead of deleting it (e.g. to fix a typo) — the cascade only matters
// for a real delete.
export default function DrinkSizeManager() {
  const [sizes, setSizes] = useState([])
  const [editing, setEditing] = useState(null) // null closed, {} = new, size = edit
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { data } = await supabase.from('drink_sizes').select('*').order('sort_order')
    setSizes(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  function openNew() {
    setName('')
    setError('')
    setEditing({})
  }
  function openEdit(size) {
    setName(size.name)
    setError('')
    setEditing(size)
  }

  async function save() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError('')
    const { error: err } = editing.id
      ? await supabase.from('drink_sizes').update({ name: name.trim() }).eq('id', editing.id)
      : await supabase.from('drink_sizes').insert({ name: name.trim(), sort_order: sizes.length })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditing(null)
    load()
  }

  async function persistOrder(next) {
    setSizes(next)
    await Promise.all(next.map((s, idx) => supabase.from('drink_sizes').update({ sort_order: idx }).eq('id', s.id)))
  }
  const { handleProps, rowProps } = useDragReorder(sizes, persistOrder)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="max-w-lg text-sm text-gray-500">
          Sizes that Drink items can offer (e.g. M / L). Pick which ones apply to each item from that item's Edit
          Item screen — each size gets its own ingredient list there.
        </p>
        <Button onClick={openNew} className="shrink-0">
          + New size
        </Button>
      </div>

      {!sizes.length ? (
        <EmptyState label="No sizes yet." />
      ) : (
        <div className="max-w-sm divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {sizes.map((s) => {
            const { isDragging, isDropTarget, ...dragRowProps } = rowProps(s.id)
            return (
              <div
                key={s.id}
                {...dragRowProps}
                className={`flex items-center justify-between px-2 py-2.5 transition-colors ${
                  isDragging ? 'opacity-40' : ''
                } ${isDropTarget ? 'bg-brand-50' : ''}`}
              >
                <DragHandle {...handleProps(s.id)} />
                <button
                  onClick={() => openEdit(s)}
                  className="flex-1 text-left text-sm font-medium text-gray-800 hover:text-brand-600"
                >
                  {s.name}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit size' : 'New size'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Size name (e.g. M, L, XL)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </Modal>
    </div>
  )
}
