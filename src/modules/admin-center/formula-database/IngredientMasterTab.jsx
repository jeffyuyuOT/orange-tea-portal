import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

const SWATCHES = ['#f97316', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#eab308', '#1f2937', '#ffffff']
const DEFAULT_RULE = {
  abbreviation: '',
  font_size: '14px',
  font_color: '#1f2937',
  background_color: '#fff7ed',
  is_bold: false,
  is_italic: false,
}

// Add / edit / delete Ingredient Master entries — name, unit, and (merged in
// from the old separate Format Rule tab) the abbreviation/colors/bold/italic
// shown on the Formula page. One edit window per ingredient instead of
// switching tabs to set its look.
//
// Renaming here is safe everywhere else in the app on its own — the
// Ingredient picker in Edit Item and the staff-facing Formula page both
// look the ingredient up by its id and read `name`/its format rule fresh
// each time, so a rename or a re-colored chip shows up the next time any
// of those load, with no separate place that needs updating. The one place
// a rename DOES matter: the Formula Import spreadsheet matches ingredients
// by name text, so an already-written import sheet using the old name
// won't match until it's updated to the new one.
export default function IngredientMasterTab() {
  const [ingredients, setIngredients] = useState([])
  const [rules, setRules] = useState({}) // ingredient_id -> format rule row
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null=closed, {}=new, row=edit
  const [deleteTarget, setDeleteTarget] = useState(null) // ingredient row being confirmed for delete

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

  const filtered = search.trim()
    ? ingredients.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
    : ingredients

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search ingredients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim() && (
          <span className="text-xs text-gray-400">
            {filtered.length} of {ingredients.length}
          </span>
        )}
        <div className="flex-1" />
        <Button onClick={() => setEditing({})}>+ New Ingredient</Button>
      </div>

      {!filtered.length ? (
        <EmptyState label={search.trim() ? `No ingredients match "${search.trim()}".` : 'No ingredients yet.'} />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {filtered.map((i) => {
            const rule = rules[i.id]
            return (
              <div key={i.id} className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">
                    {i.name} <span className="text-gray-400">{i.unit}</span>
                  </span>
                  {rule && (rule.abbreviation || rule.background_color) && (
                    <span
                      className="rounded-md border px-2 py-0.5 text-xs"
                      style={{
                        color: rule.font_color || '#1f2937',
                        backgroundColor: rule.background_color || '#fff7ed',
                        borderColor: rule.background_color || '#fed7aa',
                        fontWeight: rule.is_bold ? 700 : 400,
                        fontStyle: rule.is_italic ? 'italic' : 'normal',
                      }}
                    >
                      {rule.abbreviation || i.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="secondary" onClick={() => setEditing(i)}>
                    Edit
                  </Button>
                  <button onClick={() => setDeleteTarget(i)} className="text-gray-400 hover:text-red-500">
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <IngredientEditModal
          ingredient={editing}
          rule={editing.id ? rules[editing.id] : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {deleteTarget && (
        <DeleteIngredientModal
          ingredient={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null)
            load()
          }}
        />
      )}
    </div>
  )
}

// Shows which drinks/items use this ingredient before deleting it, so an
// admin isn't guessing. Deleting still goes through (the ingredient row
// just disappears from any formula that used it — see migration
// 0015_ingredient_delete_set_null.sql for why that's now a clean removal
// rather than a blocked foreign-key error).
function DeleteIngredientModal({ ingredient, onClose, onDeleted }) {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([]) // distinct formula items using this ingredient
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    supabase
      .from('formula_item_ingredients')
      .select('formula_item_id, formula_items(name_en, name_zh)')
      .eq('ingredient_id', ingredient.id)
      .then(({ data }) => {
        if (!active) return
        const seen = new Map()
        ;(data ?? []).forEach((r) => {
          if (r.formula_items && !seen.has(r.formula_item_id)) seen.set(r.formula_item_id, r.formula_items)
        })
        setItems([...seen.values()])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [ingredient.id])

  async function confirmDelete() {
    setDeleting(true)
    const { error } = await supabase.from('ingredient_master').delete().eq('id', ingredient.id)
    setDeleting(false)
    if (error) {
      alert(error.message)
      return
    }
    onDeleted()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete "${ingredient.name}"?`}
      footer={
        <Button variant="danger" onClick={confirmDelete} disabled={loading || deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
      }
    >
      {loading ? (
        <p className="text-sm text-gray-400">Checking which formulas use this ingredient…</p>
      ) : !items.length ? (
        <p className="text-sm text-gray-600">Not used in any formula. Safe to delete.</p>
      ) : (
        <div>
          <p className="mb-2 text-sm text-gray-600">
            Used in {items.length} formula item{items.length === 1 ? '' : 's'}. Deleting will remove it from these —
            the rest of each formula is unaffected:
          </p>
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm text-gray-700">
            {items.map((it, i) => (
              <li key={i}>
                {it.name_en}
                {it.name_zh && <span className="font-zh text-brand-600"> · {it.name_zh}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}

function IngredientEditModal({ ingredient, rule, onClose, onSaved }) {
  const [name, setName] = useState(ingredient.name ?? '')
  const [unit, setUnit] = useState(ingredient.unit ?? '')
  const [format, setFormat] = useState({ ...DEFAULT_RULE, ...rule })
  const [saving, setSaving] = useState(false)

  function patchFormat(patch) {
    setFormat((prev) => ({ ...prev, ...patch }))
  }

  async function save() {
    setSaving(true)
    let ingredientId = ingredient.id
    if (ingredientId) {
      await supabase.from('ingredient_master').update({ name, unit }).eq('id', ingredientId)
    } else {
      const { data, error } = await supabase.from('ingredient_master').insert({ name, unit }).select().single()
      if (error) {
        setSaving(false)
        alert(error.message)
        return
      }
      ingredientId = data.id
    }
    await supabase.from('ingredient_format_rules').upsert({ ingredient_id: ingredientId, ...format }, { onConflict: 'ingredient_id' })
    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={ingredient.id ? 'Edit Ingredient' : 'New Ingredient'}
      footer={
        <Button onClick={save} disabled={saving || !name}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Black Tea Base" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Unit</span>
            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="g, ml…" />
          </label>
        </div>

        <hr className="border-brand-100" />
        <p className="text-xs font-medium text-gray-500">How this ingredient shows on the Formula page</p>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Abbreviation</span>
          <input
            className="input"
            value={format.abbreviation ?? ''}
            onChange={(e) => patchFormat({ abbreviation: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Font size</span>
          <input className="input" value={format.font_size ?? ''} onChange={(e) => patchFormat({ font_size: e.target.value })} />
        </label>
        <ColorField label="Font color" value={format.font_color} onChange={(v) => patchFormat({ font_color: v })} />
        <ColorField label="Background color" value={format.background_color} onChange={(v) => patchFormat({ background_color: v })} />
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!format.is_bold} onChange={(e) => patchFormat({ is_bold: e.target.checked })} />
            Bold
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!format.is_italic} onChange={(e) => patchFormat({ is_italic: e.target.checked })} />
            Italic
          </label>
        </div>
        <div
          className="inline-block rounded-md border px-3 py-1.5 text-sm"
          style={{
            color: format.font_color,
            backgroundColor: format.background_color,
            fontSize: format.font_size,
            borderColor: format.background_color,
            fontWeight: format.is_bold ? 700 : 400,
            fontStyle: format.is_italic ? 'italic' : 'normal',
          }}
        >
          {format.abbreviation || name || 'Preview'}
        </div>

        {ingredient.id && (
          <p className="text-xs text-gray-400">
            Renaming updates every formula, this format, and the Formula page automatically — they all look this
            ingredient up by its id, not its name. The one thing to watch: a Formula Import spreadsheet already
            written with the old name won't match until it's updated to the new one.
          </p>
        )}
      </div>
    </Modal>
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
