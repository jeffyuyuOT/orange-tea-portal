import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import RichTextViewer from '../../../components/ui/RichTextViewer'
import PronounceButton from '../../../components/ui/PronounceButton'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'

// Formula + method are stored as structured data (ingredients list + step
// list) rather than an uploaded Word document — see README "Formula
// display format" for the rationale — so this view renders consistently
// for every drink/tea/topping/other item straight from the database.
export default function FormulaItemDetail({ item, onClose }) {
  const [ingredients, setIngredients] = useState([])
  const [steps, setSteps] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!item) return
    let active = true
    setLoading(true)
    Promise.all([
      supabase
        .from('formula_item_ingredients')
        .select('*, ingredient_master(name, unit), ingredient_format_rules(*)')
        .eq('formula_item_id', item.id)
        .order('sort_order'),
      supabase.from('formula_item_steps').select('*').eq('formula_item_id', item.id).order('step_number'),
    ]).then(([ingRes, stepRes]) => {
      if (!active) return
      setIngredients(ingRes.data ?? [])
      setSteps(stepRes.data ?? [])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [item])

  return (
    <Modal open={!!item} onClose={onClose} wide title={<ItemTitle item={item} />}>
      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-6">
          <section>
            <h4 className="mb-2 text-sm font-semibold text-brand-700">Ingredients</h4>
            {ingredients.length === 0 ? (
              <p className="text-sm text-gray-400">No ingredients recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {ingredients.map((ing) => (
                  <IngredientChip key={ing.id} ing={ing} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-brand-700">Method</h4>
            {steps.length === 0 ? (
              <p className="text-sm text-gray-400">No steps recorded.</p>
            ) : (
              <ol className="space-y-3">
                {steps.map((s) => (
                  <li key={s.id} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">
                      {s.step_number}
                    </span>
                    <div className="flex-1">
                      <RichTextViewer html={s.instruction_html} />
                      {s.image_path && (
                        <img src={s.image_path} alt={`Step ${s.step_number}`} className="mt-1 max-w-xs rounded-lg border border-gray-200" />
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

function ItemTitle({ item }) {
  return (
    <span className="flex items-center gap-2">
      {item?.name_en}
      {item?.name_zh && (
        <span className="flex items-center gap-1 text-brand-600 font-zh">
          · {item.name_zh}
          <PronounceButton text={item.name_zh} />
        </span>
      )}
    </span>
  )
}

function IngredientChip({ ing }) {
  if (ing.display_mode === 'custom' && ing.custom_image_path) {
    return <img src={ing.custom_image_path} alt={ing.ingredient_master?.name} className="h-10 rounded border border-gray-200" />
  }
  const rule = ing.ingredient_format_rules
  const label = rule?.abbreviation || ing.ingredient_master?.name || 'Ingredient'
  return (
    <span
      className="rounded-md border px-2 py-1 text-sm"
      style={{
        fontSize: rule?.font_size || '14px',
        color: rule?.font_color || '#1f2937',
        backgroundColor: rule?.background_color || '#fff7ed',
        borderColor: rule?.background_color || '#fed7aa',
      }}
    >
      {label} {ing.quantity_text ? `· ${ing.quantity_text}` : ''}
    </span>
  )
}
