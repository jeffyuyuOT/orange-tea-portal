import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

const SWATCHES = ['#f97316', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#eab308', '#1f2937', '#ffffff']

export default function FormatRuleTab() {
  const [ingredients, setIngredients] = useState([])
  const [rules, setRules] = useState({})
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')

  async function load() {
    const { data: ing } = await supabase.from('ingredient_master').select('*').order('name')
    const { data: ruleRows } = await supabase.from('ingredient_format_rules').select('*')
    setIngredients(ing ?? [])
    const map = {}
    ;(ruleRows ?? []).forEach((r) => (map[r.ingredient_id] = r))
    setRules(map)
  }
  useEffect(() => {
    load()
  }, [])

  const filtered = ingredients.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
  const selected = ingredients.find((i) => i.id === selectedId)
  const rule = rules[selectedId] ?? {
    abbreviation: '',
    font_size: '14px',
    font_color: '#1f2937',
    background_color: '#fff7ed',
    is_bold: false,
    is_italic: false,
  }

  function patchRule(patch) {
    setRules((prev) => ({ ...prev, [selectedId]: { ...rule, ...patch } }))
  }

  async function save() {
    setSaving(true)
    const { error } = await supabase
      .from('ingredient_format_rules')
      .upsert({ ingredient_id: selectedId, ...rule }, { onConflict: 'ingredient_id' })
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    await load()
    setSavedMessage(`Saved format for "${selected.name}".`)
    setSelectedId(null) // close the edit panel back to the empty state, like the other admin tabs' modals
  }

  function selectIngredient(id) {
    setSavedMessage('')
    setSelectedId(id)
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      <div>
        <input className="input mb-2" placeholder="Search ingredient…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {filtered.map((i) => (
            <button
              key={i.id}
              onClick={() => selectIngredient(i.id)}
              className={`block w-full px-3 py-2 text-left text-sm ${selectedId === i.id ? 'bg-brand-100 text-brand-800' : 'hover:bg-brand-50'}`}
            >
              {i.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        {!selected ? (
          <div>
            {savedMessage && (
              <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {savedMessage}
              </div>
            )}
            <EmptyState label="Select an ingredient to edit its format." />
          </div>
        ) : (
          <div className="max-w-md space-y-4 rounded-xl border border-brand-100 bg-white p-4">
            <h3 className="font-medium text-gray-800">{selected.name}</h3>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Abbreviation</span>
              <input className="input" value={rule.abbreviation ?? ''} onChange={(e) => patchRule({ abbreviation: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Font size</span>
              <input className="input" value={rule.font_size ?? ''} onChange={(e) => patchRule({ font_size: e.target.value })} />
            </label>
            <ColorField label="Font color" value={rule.font_color} onChange={(v) => patchRule({ font_color: v })} />
            <ColorField label="Background color" value={rule.background_color} onChange={(v) => patchRule({ background_color: v })} />
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={!!rule.is_bold} onChange={(e) => patchRule({ is_bold: e.target.checked })} />
                Bold
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={!!rule.is_italic} onChange={(e) => patchRule({ is_italic: e.target.checked })} />
                Italic
              </label>
            </div>
            <div
              className="rounded-md border px-3 py-1.5 text-sm inline-block"
              style={{
                color: rule.font_color,
                backgroundColor: rule.background_color,
                fontSize: rule.font_size,
                borderColor: rule.background_color,
                fontWeight: rule.is_bold ? 700 : 400,
                fontStyle: rule.is_italic ? 'italic' : 'normal',
              }}
            >
              {rule.abbreviation || selected.name}
            </div>
            <div>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 rounded border border-gray-200" />
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          spellCheck={false}
          className="input w-28 font-mono text-xs uppercase"
        />
        <div className="flex gap-1">
          {SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => onChange(c)}
              className="h-6 w-6 rounded-full border border-gray-200"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      {/* The Import File "Font/Background Color (hex, optional)" column wants
          exactly this text — there's no separate "color name" to look up,
          the swatch above and this code are the same value. */}
      <p className="mt-1 text-xs text-gray-400">Copy this code into the Import File's color column: {value}</p>
    </div>
  )
}
