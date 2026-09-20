import { useState } from 'react'
import IngredientInventoryTab from './IngredientInventoryTab'
import IngredientMasterTab from './IngredientMasterTab'
import DrinkSizeManager from './DrinkSizeManager'

// Format Rule used to be its own tab here — it's now folded into Ingredient
// Master's Edit window (abbreviation/colors/bold/italic alongside name and
// unit), so there's one place to set up an ingredient instead of two.
const TABS = [
  { key: 'inventory', label: 'Ingredient Inventory' },
  { key: 'master', label: 'Ingredient Master' },
  { key: 'sizes', label: 'Drink Sizes' },
]

export default function FormulaDatabasePage() {
  const [tab, setTab] = useState('inventory')

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Formula Database</h1>
      <p className="mb-4 text-sm text-gray-500">Manage every drink/tea/topping/other formula shown in Operations & Training.</p>

      <div className="mb-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inventory' && <IngredientInventoryTab />}
      {tab === 'master' && <IngredientMasterTab />}
      {tab === 'sizes' && <DrinkSizeManager />}
    </div>
  )
}
