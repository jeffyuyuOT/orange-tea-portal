import { useState } from 'react'
import CategoryManager from './CategoryManager'
import ItemManager from './ItemManager'

const GROUPS = [
  { key: 'drink', label: 'Drink' },
  { key: 'tea', label: 'Tea' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'others', label: 'Others' },
]

export default function IngredientInventoryTab() {
  const [group, setGroup] = useState('drink')
  const [category, setCategory] = useState(null)

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-brand-100">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => {
              setGroup(g.key)
              setCategory(null)
            }}
            className={`px-4 py-2 text-sm font-medium ${
              group === g.key ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {group === 'drink' && !category && <CategoryManager onSelect={setCategory} />}
      {group === 'drink' && category && (
        <ItemManager groupKey="drink" categoryId={category.id} onBack={() => setCategory(null)} backLabel={`← ${category.name}`} />
      )}
      {group !== 'drink' && <ItemManager groupKey={group} categoryId={null} />}
    </div>
  )
}
