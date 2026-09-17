import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

// Searchable dropdown pulling from Ingredient Master (typing filters the list).
export default function IngredientPicker({ value, onChange }) {
  const [all, setAll] = useState([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    supabase.from('ingredient_master').select('*').order('name').then(({ data }) => setAll(data ?? []))
  }, [])

  const selected = all.find((i) => i.id === value)
  const filtered = all.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="relative w-48">
      <input
        className="input"
        placeholder="Search ingredient…"
        value={open ? query : selected?.name ?? ''}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">No matches</div>
          ) : (
            filtered.map((i) => (
              <button
                key={i.id}
                onMouseDown={() => {
                  onChange(i.id)
                  setOpen(false)
                }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-50"
              >
                {i.name} <span className="text-gray-400">{i.unit}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
