import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import RichTextViewer from '../../../components/ui/RichTextViewer'

// Jeff, 2026-10-26: "shop training頁面,有的內容想做分類...點進去就有pos內容,
// 有的不用分類的就照常" — content can optionally sit inside a Category
// (`shop_training_categories`, managed from Shop Training Database; see that
// file's own notes). A category with at least one item visible to this
// account shows as a 📁 folder row at the top level; tapping it drills into
// just that category's items. Items with no category render exactly as
// before (flat, directly in the main list) — nothing changes for them.
export default function ShopTrainingPage() {
  const { profile, currentStoreId } = useAuth()
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  // null = top-level view. Set to a category's id to drill into it.
  const [openCategoryId, setOpenCategoryId] = useState(null)
  const [openItem, setOpenItem] = useState(null)
  const [openItemFiles, setOpenItemFiles] = useState([])

  useEffect(() => {
    let active = true
    async function load() {
      if (!currentStoreId) return
      // Since migration 0052, training content is owned by the store itself
      // (store_id) rather than one shared global list with an optional
      // "visible at these stores" restriction — so this is just a plain
      // per-store filter now, same as everything else scoped by
      // currentStoreId.
      let query = supabase.from('shop_training_items').select('*').eq('store_id', currentStoreId).order('sort_order')
      // Training-role accounts only ever see content an admin/manager marked visible.
      if (profile?.role === 'training') query = query.eq('visible_to_training', true)
      const [{ data: itemRows }, { data: categoryRows }] = await Promise.all([
        query,
        supabase.from('shop_training_categories').select('*').eq('store_id', currentStoreId).order('sort_order'),
      ])
      if (!active) return
      setItems(itemRows ?? [])
      setCategories(categoryRows ?? [])
      setLoading(false)
    }
    setLoading(true)
    setOpenCategoryId(null) // switching stores — the open category belonged to the old one
    load()
    return () => {
      active = false
    }
  }, [profile, currentStoreId])

  // At the top level: categories that actually have a (visible) item in
  // them, plus the items with no category at all, in that order. Inside a
  // category: just that category's items.
  const visibleItems = openCategoryId
    ? items.filter((i) => i.category_id === openCategoryId)
    : items.filter((i) => !i.category_id)
  const categoriesWithItems = openCategoryId ? [] : categories.filter((c) => items.some((i) => i.category_id === c.id))
  const openCategory = openCategoryId ? categories.find((c) => c.id === openCategoryId) : null

  // Fetched per item as it's opened rather than bulk-loaded upfront with
  // the list, since most items are never opened in a given visit.
  useEffect(() => {
    if (!openItem) {
      setOpenItemFiles([])
      return
    }
    let active = true
    supabase
      .from('shop_training_item_files')
      .select('*')
      .eq('shop_training_item_id', openItem.id)
      .order('sort_order')
      .then(({ data }) => {
        if (active) setOpenItemFiles(data ?? [])
      })
    return () => {
      active = false
    }
  }, [openItem])

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Shop Training</h1>
      {openCategoryId ? (
        <>
          <button
            onClick={() => setOpenCategoryId(null)}
            className="mb-2 flex items-center gap-1 text-sm text-brand-600 hover:underline"
          >
            ‹ Back to Shop Training
          </button>
          <p className="mb-4 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <span>📁</span>
            {openCategory?.name}
          </p>
        </>
      ) : (
        <p className="mb-4 text-sm text-gray-500">In-store training material. Tap a title to read the full content.</p>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : !categoriesWithItems.length && !visibleItems.length ? (
        <EmptyState label={openCategoryId ? 'No items in this category yet.' : 'No shop training content yet.'} />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {categoriesWithItems.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpenCategoryId(c.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="flex items-center gap-2 font-medium text-gray-800">
                <span>📁</span>
                {c.name}
              </span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
          {visibleItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setOpenItem(item)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="font-medium text-gray-800">{item.title}</span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!openItem} onClose={() => setOpenItem(null)} title={openItem?.title} wide>
        <RichTextViewer html={openItem?.content_html} />
        {openItemFiles.length > 0 && (
          <div className="mt-4 border-t border-brand-100 pt-3">
            <div className="mb-1.5 text-xs font-semibold text-gray-500">Attached files</div>
            <div className="space-y-1">
              {openItemFiles.map((f) => (
                <a
                  key={f.id}
                  href={supabase.storage.from('documents').getPublicUrl(f.file_path).data.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline"
                >
                  📎 {f.display_name}
                </a>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
