import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import IngredientPicker from './IngredientPicker'

async function uploadImage(file, pathPrefix) {
  const path = `${pathPrefix}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage.from('formula-images').upload(path, file, { upsert: true })
  if (error) throw error
  return supabase.storage.from('formula-images').getPublicUrl(path).data.publicUrl
}

export default function ItemEditModal({ item, nextSortOrder, onClose, onSaved }) {
  const { profile, accessibleStores } = useAuth()
  const isNew = !item.id
  const [nameEn, setNameEn] = useState(item.name_en ?? '')
  const [nameZh, setNameZh] = useState(item.name_zh ?? '')
  const [ingredients, setIngredients] = useState([])
  const [steps, setSteps] = useState([])
  const [visibleStoreIds, setVisibleStoreIds] = useState(null) // null = all stores
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) return
    supabase
      .from('formula_item_ingredients')
      .select('*')
      .eq('formula_item_id', item.id)
      .order('sort_order')
      .then(({ data }) => setIngredients(data ?? []))
    supabase
      .from('formula_item_steps')
      .select('*')
      .eq('formula_item_id', item.id)
      .order('step_number')
      .then(({ data }) => setSteps(data ?? []))
    supabase
      .from('formula_item_stores')
      .select('store_id')
      .eq('formula_item_id', item.id)
      .then(({ data }) => setVisibleStoreIds(data?.length ? data.map((r) => r.store_id) : null))
  }, [item.id])

  function addIngredient() {
    setIngredients((prev) => [
      ...prev,
      { _key: Math.random(), ingredient_id: '', quantity_text: '', display_mode: 'standard', custom_image_path: '', sort_order: prev.length },
    ])
  }
  function updateIngredient(idx, patch) {
    setIngredients((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeIngredient(idx) {
    setIngredients((prev) => prev.filter((_, i) => i !== idx))
  }

  function addStep() {
    setSteps((prev) => [...prev, { _key: Math.random(), step_number: prev.length + 1, instruction_html: '', image_path: '' }])
  }
  function updateStep(idx, patch) {
    setSteps((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeStep(idx) {
    setSteps((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_number: i + 1 })))
  }

  async function save() {
    setSaving(true)
    try {
      let itemId = item.id
      const base = { name_en: nameEn, name_zh: nameZh, group_key: item.group_key, category_id: item.category_id ?? null }
      if (isNew) {
        const { data, error } = await supabase
          .from('formula_items')
          .insert({ ...base, sort_order: nextSortOrder, created_by: profile.id })
          .select()
          .single()
        if (error) throw error
        itemId = data.id
      } else {
        const { error } = await supabase.from('formula_items').update(base).eq('id', itemId)
        if (error) throw error
        await supabase.from('formula_item_ingredients').delete().eq('formula_item_id', itemId)
        await supabase.from('formula_item_steps').delete().eq('formula_item_id', itemId)
        await supabase.from('formula_item_stores').delete().eq('formula_item_id', itemId)
      }

      if (ingredients.length) {
        await supabase.from('formula_item_ingredients').insert(
          ingredients.map((ing, idx) => ({
            formula_item_id: itemId,
            ingredient_id: ing.ingredient_id || null,
            quantity_text: ing.quantity_text,
            display_mode: ing.display_mode,
            custom_image_path: ing.custom_image_path || null,
            sort_order: idx,
          }))
        )
      }
      if (steps.length) {
        await supabase.from('formula_item_steps').insert(
          steps.map((s, idx) => ({
            formula_item_id: itemId,
            step_number: idx + 1,
            instruction_html: s.instruction_html,
            image_path: s.image_path || null,
          }))
        )
      }
      if (visibleStoreIds && visibleStoreIds.length) {
        await supabase.from('formula_item_stores').insert(visibleStoreIds.map((storeId) => ({ formula_item_id: itemId, store_id: storeId })))
      }
      onSaved()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? 'New Item' : 'Edit Item'}
      footer={
        <Button onClick={save} disabled={saving || !nameEn}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Name (English)</span>
            <input className="input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Name (Chinese, optional)</span>
            <input className="input font-zh" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
          </label>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">Visible at stores (default: all)</span>
          <div className="flex flex-wrap gap-3">
            {accessibleStores.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={visibleStoreIds === null || visibleStoreIds.includes(s.id)}
                  onChange={(e) => {
                    setVisibleStoreIds((prev) => {
                      const current = prev === null ? accessibleStores.map((x) => x.id) : prev
                      return e.target.checked ? [...current, s.id] : current.filter((id) => id !== s.id)
                    })
                  }}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-brand-700">Ingredients</h4>
            <Button variant="secondary" onClick={addIngredient}>
              + Add ingredient
            </Button>
          </div>
          <div className="space-y-2">
            {ingredients.map((ing, idx) => (
              <div key={ing._key ?? ing.id} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
                <IngredientPicker value={ing.ingredient_id} onChange={(id) => updateIngredient(idx, { ingredient_id: id })} />
                <input
                  className="input w-28"
                  placeholder="Qty e.g. 30g"
                  value={ing.quantity_text}
                  onChange={(e) => updateIngredient(idx, { quantity_text: e.target.value })}
                />
                <select
                  className="input w-32"
                  value={ing.display_mode}
                  onChange={(e) => updateIngredient(idx, { display_mode: e.target.value })}
                >
                  <option value="standard">Standard</option>
                  <option value="custom">Custom image</option>
                </select>
                {ing.display_mode === 'custom' && (
                  <label className="cursor-pointer rounded-lg border border-brand-300 px-2 py-1 text-xs text-brand-700">
                    {ing.custom_image_path ? 'Image set' : 'Upload'}
                    <input
                      type="file"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files[0]
                        if (!f) return
                        const url = await uploadImage(f, 'ingredients')
                        updateIngredient(idx, { custom_image_path: url })
                      }}
                    />
                  </label>
                )}
                <button onClick={() => removeIngredient(idx)} className="ml-auto text-gray-400 hover:text-red-500">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-brand-700">Method (steps)</h4>
            <Button variant="secondary" onClick={addStep}>
              + Add step
            </Button>
          </div>
          <div className="space-y-3">
            {steps.map((s, idx) => (
              <div key={s._key ?? s.id} className="rounded-lg border border-gray-200 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-brand-500">Step {idx + 1}</span>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer text-xs text-brand-600 hover:underline">
                      {s.image_path ? 'Change image' : 'Add image'}
                      <input
                        type="file"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files[0]
                          if (!f) return
                          const url = await uploadImage(f, 'steps')
                          updateStep(idx, { image_path: url })
                        }}
                      />
                    </label>
                    <button onClick={() => removeStep(idx)} className="text-gray-400 hover:text-red-500">
                      ✕
                    </button>
                  </div>
                </div>
                <SimpleRichTextEditor value={s.instruction_html} onChange={(v) => updateStep(idx, { instruction_html: v })} />
                {s.image_path && <img src={s.image_path} alt="" className="mt-2 max-w-xs rounded-lg border border-gray-200" />}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}
