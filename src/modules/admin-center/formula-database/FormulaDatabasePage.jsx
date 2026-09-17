import { useState } from 'react'
import IngredientInventoryTab from './IngredientInventoryTab'
import FormatRuleTab from './FormatRuleTab'
import IngredientMasterTab from './IngredientMasterTab'

const TABS = [
  { key: 'inventory', label: 'Ingredient Inventory' },
  { key: 'format', label: 'Format Rule' },
  { key: 'master', label: 'Ingredient Master' },
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
      {tab === 'format' && <FormatRuleTab />}
      {tab === 'master' && <IngredientMasterTab />}
    </div>
  )
}
