import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { filterVisibleForStore } from '../../../lib/storeVisibility'
import { getUnseenFormulaItems } from '../../../lib/formulaUpdates'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import PronounceButton from '../../../components/ui/PronounceButton'
import TipsModal from './TipsModal'
import FormulaItemDetail from './FormulaItemDetail'

const GROUPS = [
  { key: 'drink', label: 'Drink' },
  { key: 'tea', label: 'Tea' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'others', label: 'Others' },
]

const GROUP_LABELS = Object.fromEntries(GROUPS.map((g) => [g.key, g.label]))

// A synthetic category, not a real `formula_categories` row — gathers every
// drink flagged "Top 10" (Admin Center > Formula Database > edit a drink)
// regardless of which real category it's in. Picking it doesn't move a
// drink out of its own category; it's the same formula_items row shown a
// second time. Always shown first, automatically, so admins never have to
// create/maintain it themselves.
const TOP10_CATEGORY = { id: '__top10__', name: '⭐ Top 10' }

// Jeff, 2026-09-30 (same-day revision): "Formula裡新增must know item分類，
// 把所有must-know item放在其分類下" — same synthetic-category shape as
// TOP10_CATEGORY above (not a real `formula_categories` row, doesn't move a
// drink out of its own category), gathering every drink flagged Must Know
// Item (is_must_know) regardless of which real category it's in. Shown
// right after Top 10.
const MUSTKNOW_CATEGORY = { id: '__mustknow__', name: '⭐ Must Know Item' }

export default function FormulaPage() {
  const { profile, currentStoreId } = useAuth()
  const [group, setGroup] = useState('drink')
  const [category, setCategory] = useState(null) // drilled-into category, drink group only
  const [tipsCategory, setTipsCategory] = useState(null)
  const [openItem, setOpenItem] = useState(null)
  // New/edited-since-last-seen items, across every group — see migration
  // 0053 / src/lib/formulaUpdates.js. Loaded once per person+store rather
  // than inside the "Update" tab itself, so the tab can simply not render
  // at all when this is empty (per Jeff's spec: no updates = no tab).
  const [updateItems, setUpdateItems] = useState([])

  useEffect(() => {
    let active = true
    getUnseenFormulaItems(profile?.id, currentStoreId).then((items) => {
      if (active) setUpdateItems(items)
    })
    return () => {
      active = false
    }
  }, [profile?.id, currentStoreId])

  // If the "Update" tab itself disappears (its last item just got opened
  // and marked seen) while it was the active tab, fall back to Drink rather
  // than leaving the page on a now-nonexistent tab.
  useEffect(() => {
    if (group === 'update' && !updateItems.length) setGroup('drink')
  }, [group, updateItems.length])

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Formula</h1>
      <p className="mb-4 text-sm text-gray-500">Browse drink recipes, tea, toppings and other prep instructions.</p>

      <div className="mb-5 flex gap-1 border-b border-brand-100">
        {updateItems.length > 0 && (
          <button
            onClick={() => {
              setGroup('update')
              setCategory(null)
            }}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium ${
              group === 'update' ? 'border-b-2 border-red-500 text-red-600' : 'text-red-500 hover:text-red-600'
            }`}
          >
            Update
            <Badge color="red">{updateItems.length}</Badge>
          </button>
        )}
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => {
              setGroup(g.key)
              setCategory(null)
            }}
            className={`px-4 py-2 text-sm font-medium ${
              group === g.key
                ? 'border-b-2 border-brand-500 text-brand-700'
                : 'text-gray-500 hover:text-brand-600'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {group === 'update' && <UpdateItemList items={updateItems} onOpenItem={setOpenItem} />}
      {group === 'drink' && !category && (
        <DrinkCategories onSelect={setCategory} onTips={setTipsCategory} />
      )}
      {group === 'drink' && category && (
        <ItemList
          groupKey="drink"
          categoryId={category.id === TOP10_CATEGORY.id || category.id === MUSTKNOW_CATEGORY.id ? null : category.id}
          topTen={category.id === TOP10_CATEGORY.id}
          mustKnow={category.id === MUSTKNOW_CATEGORY.id}
          storeId={currentStoreId}
          onBack={() => setCategory(null)}
          backLabel={`← ${category.name}`}
          onOpenItem={setOpenItem}
        />
      )}
      {group !== 'drink' && group !== 'update' && (
        <ItemList groupKey={group} categoryId={null} storeId={currentStoreId} onOpenItem={setOpenItem} />
      )}

      <TipsModal category={tipsCategory} onClose={() => setTipsCategory(null)} />
      <FormulaItemDetail
        item={openItem}
        onClose={() => setOpenItem(null)}
        onSeen={(itemId) => setUpdateItems((prev) => prev.filter((i) => i.id !== itemId))}
      />
    </div>
  )
}

// Flat list spanning every group (a modified item could be a tea or topping,
// not just a drink) — each row is tagged with its group (and drink category,
// where there is one) since they're mixed together here.
function UpdateItemList({ items, onOpenItem }) {
  const [categoryNames, setCategoryNames] = useState({}) // category_id -> name, drink items only

  useEffect(() => {
    const categoryIds = [...new Set(items.filter((i) => i.category_id).map((i) => i.category_id))]
    if (!categoryIds.length) {
      setCategoryNames({})
      return
    }
    supabase
      .from('formula_categories')
      .select('id, name')
      .in('id', categoryIds)
      .then(({ data }) => setCategoryNames(Object.fromEntries((data ?? []).map((c) => [c.id, c.name]))))
  }, [items])

  return (
    <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onOpenItem(item)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
        >
          <span className="flex items-center gap-2">
            <span className="font-medium text-gray-800">{item.name_en}</span>
            {item.name_zh && (
              <span className="flex items-center gap-1 text-sm text-brand-600 font-zh">
                {item.name_zh}
                <PronounceButton text={item.name_zh} />
              </span>
            )}
            <span className="text-xs text-gray-400">
              {GROUP_LABELS[item.group_key] ?? item.group_key}
              {categoryNames[item.category_id] ? ` · ${categoryNames[item.category_id]}` : ''}
            </span>
          </span>
          <span className="text-gray-300">›</span>
        </button>
      ))}
    </div>
  )
}

function DrinkCategories({ onSelect, onTips }) {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase
      .from('formula_categories')
      .select('*')
      .eq('group_key', 'drink')
      .order('sort_order')
      .order('id')
      .then(({ data }) => {
        if (active) {
          setCategories(data ?? [])
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  if (loading) return <LoadingSpinner />

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        onClick={() => onSelect(TOP10_CATEGORY)}
        className="flex items-center justify-between rounded-xl border border-brand-100 bg-white p-4 text-left shadow-sm hover:border-brand-300"
      >
        <div className="font-medium text-gray-800">{TOP10_CATEGORY.name}</div>
      </button>
      <button
        onClick={() => onSelect(MUSTKNOW_CATEGORY)}
        className="flex items-center justify-between rounded-xl border border-brand-100 bg-white p-4 text-left shadow-sm hover:border-brand-300"
      >
        <div className="font-medium text-gray-800">{MUSTKNOW_CATEGORY.name}</div>
      </button>
      {!categories.length && (
        <div className="sm:col-span-2 lg:col-span-3">
          <EmptyState label="No drink categories yet — add some in Admin Center > Formula Database." />
        </div>
      )}
      {categories.map((cat) => (
        <div
          key={cat.id}
          className="flex items-center justify-between rounded-xl border border-brand-100 bg-white p-4 shadow-sm hover:border-brand-300"
        >
          <button onClick={() => onSelect(cat)} className="flex-1 text-left">
            <div className="font-medium text-gray-800">{cat.name}</div>
          </button>
          <Button variant="secondary" onClick={() => onTips(cat)} className="ml-2 shrink-0">
            Tips
          </Button>
        </div>
      ))}
    </div>
  )
}

function ItemList({ groupKey, categoryId, topTen, mustKnow, storeId, onBack, backLabel, onOpenItem }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    async function load() {
      let query = supabase
        .from('formula_items')
        .select('*')
        .eq('group_key', groupKey)
        .eq('is_active', true)
        .eq('hide_from_formula', false)
      query = topTen
        ? query.eq('top_10', true)
        : mustKnow
          ? query.eq('is_must_know', true)
          : categoryId
            ? query.eq('category_id', categoryId)
            : query.is('category_id', null)
      // Jeff, 2026-09-30: "被勾取menu item的飲料在formula裡會排在非menu item
      // 上面" (renamed the same day to "Must Know Item") -- same as
      // ItemManager.jsx's admin list, only for the normal (non-topTen,
      // non-mustKnow) view; the Must Know Item category is meaningless to
      // sort by this (every row in it already has is_must_know = true).
      if (!topTen && !mustKnow) query = query.order('is_must_know', { ascending: false })
      // Jeff, 2026-10-02: "must-know item分類裡(formula跟study log都是)，同時
      // 是top10的item要排在上面" — within the Must Know Item category itself,
      // a drink that's ALSO Top 10 still floats to the top of this list.
      if (mustKnow) query = query.order('top_10', { ascending: false })
      const { data: itemRows } = await query.order(topTen ? 'top_10_sort_order' : 'sort_order').order('id')
      const ids = (itemRows ?? []).map((i) => i.id)
      let restrictionRows = []
      if (ids.length) {
        const { data } = await supabase.from('formula_item_stores').select('*').in('formula_item_id', ids)
        restrictionRows = data ?? []
      }
      if (!active) return
      const visible = filterVisibleForStore(itemRows ?? [], restrictionRows, 'formula_item_id', storeId)
      setItems(visible)
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [groupKey, categoryId, topTen, mustKnow, storeId])

  return (
    <div>
      {onBack && (
        <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-600 hover:underline">
          {backLabel}
        </button>
      )}
      {loading ? (
        <LoadingSpinner />
      ) : !items.length ? (
        <EmptyState label="No items in this category yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onOpenItem(item)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium text-gray-800">{item.name_en}</span>
                {item.name_zh && (
                  <span className="flex items-center gap-1 text-sm text-brand-600 font-zh">
                    {item.name_zh}
                    <PronounceButton text={item.name_zh} />
                  </span>
                )}
                {item.is_must_know && (
                  <span className="text-amber-500" title="Must Know Item">
                    ⭐
                  </span>
                )}
              </span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
