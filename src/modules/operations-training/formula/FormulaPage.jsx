import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { filterVisibleForStore } from '../../../lib/storeVisibility'
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

export default function FormulaPage() {
  const { currentStoreId } = useAuth()
  const [group, setGroup] = useState('drink')
  const [category, setCategory] = useState(null) // drilled-into category, drink group only
  const [tipsCategory, setTipsCategory] = useState(null)
  const [openItem, setOpenItem] = useState(null)

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Formula</h1>
      <p className="mb-4 text-sm text-gray-500">Browse drink recipes, tea, toppings and other prep instructions.</p>

      <div className="mb-5 flex gap-1 border-b border-brand-100">
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

      {group === 'drink' && !category && (
        <DrinkCategories onSelect={setCategory} onTips={setTipsCategory} />
      )}
      {group === 'drink' && category && (
        <ItemList
          groupKey="drink"
          categoryId={category.id}
          storeId={currentStoreId}
          onBack={() => setCategory(null)}
          backLabel={`← ${category.name}`}
          onOpenItem={setOpenItem}
        />
      )}
      {group !== 'drink' && (
        <ItemList groupKey={group} categoryId={null} storeId={currentStoreId} onOpenItem={setOpenItem} />
      )}

      <TipsModal category={tipsCategory} onClose={() => setTipsCategory(null)} />
      <FormulaItemDetail item={openItem} onClose={() => setOpenItem(null)} />
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
  if (!categories.length) return <EmptyState label="No drink categories yet — add some in Admin Center > Formula Database." />

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

function ItemList({ groupKey, categoryId, storeId, onBack, backLabel, onOpenItem }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    async function load() {
      let query = supabase.from('formula_items').select('*').eq('group_key', groupKey).eq('is_active', true)
      query = categoryId ? query.eq('category_id', categoryId) : query.is('category_id', null)
      const { data: itemRows } = await query.order('sort_order').order('id')
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
  }, [groupKey, categoryId, storeId])

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
              </span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
