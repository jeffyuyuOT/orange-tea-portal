import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { useDragReorder, DragHandle } from '../../../lib/useDragReorder'
import ItemEditModal from './ItemEditModal'

// Lists formula_items for a given group (+ optional category), with
// add / sort / edit — used for Drink items inside a category, for the
// flat Tea / Toppings / Others lists, and (via `topTen`) for the synthetic
// "Top 10" category (see CategoryManager.jsx's TOP10_CATEGORY /
// IngredientInventoryTab.jsx).
//
// `topTen`: lists every drink flagged top_10 = true, across every real
// category, instead of filtering by categoryId — and orders/reorders them
// by their own `top_10_sort_order` instead of `sort_order`, so arranging
// the Top 10 list never touches a drink's position in its real category
// (and vice versa). New items can't be created from here (they belong to a
// real category first), and Copy/Delete are hidden too — deleting a drink
// from here would delete it everywhere, not just remove it from Top 10;
// that's done from the drink's own Edit (uncheck "Top 10" there instead).
export default function ItemManager({ groupKey, categoryId, topTen = false, onBack, backLabel }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const sortField = topTen ? 'top_10_sort_order' : 'sort_order'

  async function load() {
    let q = supabase.from('formula_items').select('*').eq('group_key', groupKey)
    q = topTen ? q.eq('top_10', true) : categoryId ? q.eq('category_id', categoryId) : q.is('category_id', null)
    // Secondary "id" tiebreak: bulk-imported items used to all share the
    // same sort_order, and Postgres doesn't promise a stable order among
    // tied rows — without this, the list (and the ↑↓ buttons) could
    // reshuffle itself on every reload.
    const { data } = await q.order(sortField).order('id')
    setItems(data ?? [])
  }
  useEffect(() => {
    load()
  }, [groupKey, categoryId, topTen])

  // Dragging a row can move it several places in one go, so — unlike the
  // old ↑↓ buttons, which only ever swapped two adjacent sort_order values —
  // a drop rewrites every item's sort_order (or, in Top 10 mode,
  // top_10_sort_order) to match its new position.
  async function persistOrder(next) {
    setItems(next)
    await Promise.all(next.map((it, idx) => supabase.from('formula_items').update({ [sortField]: idx }).eq('id', it.id)))
  }
  const { handleProps, rowProps } = useDragReorder(items, persistOrder)

  async function remove(id) {
    if (!confirm('Delete this item and its formula/steps?')) return
    await supabase.from('formula_items').delete().eq('id', id)
    load()
  }

  // Duplicates an item and every piece of its content — ingredients (all
  // sizes/hot state), method steps, above/below annotations, Notes (incl.
  // its image/video), and video links — so admins can use an existing
  // drink as a starting point instead of rebuilding one from scratch. The
  // copy is placed last in this list, named "<original>-copy"; it shares
  // the same uploaded images/videos as the original (those are just
  // storage links, so there's nothing to duplicate there) but every DB row
  // is its own independent copy — editing one afterward never touches the
  // other.
  async function copy(item) {
    const { data: newItem, error } = await supabase
      .from('formula_items')
      .insert({
        group_key: item.group_key,
        category_id: item.category_id,
        name_en: `${item.name_en}-copy`,
        name_zh: item.name_zh,
        sort_order: items.length,
        is_active: item.is_active,
        display_mode: item.display_mode,
        custom_image_path: item.custom_image_path,
        notes: item.notes,
        notes_image_path: item.notes_image_path,
        has_hot_version: item.has_hot_version,
      })
      .select()
      .single()
    if (error) {
      alert(error.message)
      return
    }

    const [ingRes, stepRes, sizeRes, annRes, videoRes, storeRes] = await Promise.all([
      supabase.from('formula_item_ingredients').select('*').eq('formula_item_id', item.id),
      supabase.from('formula_item_steps').select('*').eq('formula_item_id', item.id),
      supabase.from('formula_item_sizes').select('*').eq('formula_item_id', item.id),
      supabase.from('formula_item_annotations').select('*').eq('formula_item_id', item.id),
      supabase.from('formula_item_videos').select('*').eq('formula_item_id', item.id),
      supabase.from('formula_item_stores').select('*').eq('formula_item_id', item.id),
    ])

    const inserts = []
    if (ingRes.data?.length) {
      inserts.push(
        supabase
          .from('formula_item_ingredients')
          .insert(ingRes.data.map(({ id: _id, formula_item_id: _fid, ...rest }) => ({ ...rest, formula_item_id: newItem.id })))
      )
    }
    if (stepRes.data?.length) {
      inserts.push(
        supabase
          .from('formula_item_steps')
          .insert(stepRes.data.map(({ id: _id, formula_item_id: _fid, ...rest }) => ({ ...rest, formula_item_id: newItem.id })))
      )
    }
    if (sizeRes.data?.length) {
      inserts.push(
        supabase
          .from('formula_item_sizes')
          .insert(sizeRes.data.map(({ formula_item_id: _fid, ...rest }) => ({ ...rest, formula_item_id: newItem.id })))
      )
    }
    if (annRes.data?.length) {
      inserts.push(
        supabase
          .from('formula_item_annotations')
          .insert(annRes.data.map(({ id: _id, formula_item_id: _fid, ...rest }) => ({ ...rest, formula_item_id: newItem.id })))
      )
    }
    if (videoRes.data?.length) {
      inserts.push(
        supabase
          .from('formula_item_videos')
          .insert(videoRes.data.map(({ id: _id, formula_item_id: _fid, ...rest }) => ({ ...rest, formula_item_id: newItem.id })))
      )
    }
    if (storeRes.data?.length) {
      inserts.push(
        supabase
          .from('formula_item_stores')
          .insert(storeRes.data.map(({ formula_item_id: _fid, ...rest }) => ({ ...rest, formula_item_id: newItem.id })))
      )
    }
    const results = await Promise.all(inserts)
    const copyErr = results.find((r) => r.error)?.error
    if (copyErr) alert(copyErr.message)
    load()
  }

  return (
    <div>
      {onBack && (
        <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-600 hover:underline">
          {backLabel}
        </button>
      )}
      {topTen ? (
        <p className="mb-3 text-sm text-gray-500">
          Drag to reorder how these drinks appear in the Formula page's Top 10 category — this doesn't change their
          order in their own category. Click a drink to edit it or un-check "Top 10".
        </p>
      ) : (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setEditing({ group_key: groupKey, category_id: categoryId })}>+ New Item</Button>
        </div>
      )}
      {!items.length ? (
        <EmptyState label={topTen ? 'No drinks marked Top 10 yet — check "Top 10" when editing a drink.' : 'No items yet.'} />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {items.map((item) => {
            const { isDragging, isDropTarget, ...dragRowProps } = rowProps(item.id)
            return (
              <div
                key={item.id}
                {...dragRowProps}
                className={`flex items-center justify-between px-2 py-2.5 transition-colors ${
                  isDragging ? 'opacity-40' : ''
                } ${isDropTarget ? 'bg-brand-50' : ''}`}
              >
                <DragHandle {...handleProps(item.id)} />
                <button onClick={() => setEditing(item)} className="flex-1 text-left font-medium text-gray-800 hover:text-brand-600">
                  {item.name_en} {item.name_zh && <span className="font-zh text-brand-500">· {item.name_zh}</span>}
                </button>
                {!topTen && (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => copy(item)}>
                      Copy
                    </Button>
                    <Button variant="danger" onClick={() => remove(item.id)}>
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
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
