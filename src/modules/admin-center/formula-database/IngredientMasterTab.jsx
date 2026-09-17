import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

export default function IngredientMasterTab() {
  const [ingredients, setIngredients] = useState([])
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')

  async function load() {
    const { data } = await supabase.from('ingredient_master').select('*').order('name')
    setIngredients(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function add() {
    if (!name) return
    await supabase.from('ingredient_master').insert({ name, unit })
    setName('')
    setUnit('')
    load()
  }

  async function remove(id) {
    if (!confirm('Delete this ingredient? Formulas referencing it will lose the reference.')) return
    await supabase.from('ingredient_master').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <div className="mb-4 flex gap-2 rounded-xl border border-brand-100 bg-white p-4">
        <input className="input" placeholder="Ingredient name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input w-32" placeholder="Unit (g, ml…)" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <Button onClick={add}>Add</Button>
      </div>

      {!ingredients.length ? (
        <EmptyState label="No ingredients yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {ingredients.map((i) => (
            <div key={i.id} className="flex items-center justify-between px-4 py-2">
              <span className="text-sm text-gray-700">
                {i.name} <span className="text-gray-400">{i.unit}</span>
              </span>
              <button onClick={() => remove(i.id)} className="text-gray-400 hover:text-red-500">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
