import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import RichTextViewer from '../../../components/ui/RichTextViewer'
import PronounceButton from '../../../components/ui/PronounceButton'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import FormulaIngredientsView from './FormulaIngredientsView'
import MediaPreview from '../../../components/ui/MediaPreview'

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim()
}

// Formula + method are stored as structured data (ingredients list + step
// list) rather than an uploaded Word document — see README "Formula
// display format" for the rationale — so this view renders consistently
// for every drink/tea/topping/other item straight from the database. The
// ingredients/notes section itself is drawn by FormulaIngredientsView,
// shared with Edit Item's live Preview so the two can't drift apart.
export default function FormulaItemDetail({ item, onClose }) {
  const [allIngredients, setAllIngredients] = useState([])
  const [sizes, setSizes] = useState([]) // sizes this item offers; [] = single formula, no sizing
  const [annotationsAbove, setAnnotationsAbove] = useState([])
  const [annotationsBelow, setAnnotationsBelow] = useState([])
  const [videos, setVideos] = useState([])
  const [steps, setSteps] = useState([])
  const [loading, setLoading] = useState(true)
  const [showHot, setShowHot] = useState(false) // Iced/Cold vs Hot, when item.has_hot_version

  useEffect(() => {
    if (!item) return
    let active = true
    setLoading(true)
    setShowHot(false) // always open on Iced/Cold, even if a previous item was left on Hot
    Promise.all([
      // Note: ingredient_format_rules is embedded THROUGH ingredient_master,
      // not directly off formula_item_ingredients — there's no foreign key
      // between those two tables (both merely reference ingredient_master),
      // so a flat "ingredient_master(...), ingredient_format_rules(*)"
      // select silently fails to resolve and PostgREST returns an error,
      // which the old code swallowed with `?? []`, showing "No ingredients
      // recorded" even when ingredients existed.
      supabase
        .from('formula_item_ingredients')
        .select('*, ingredient_master(name, unit, ingredient_format_rules(*))')
        .eq('formula_item_id', item.id)
        .order('sort_order'),
      supabase.from('formula_item_steps').select('*').eq('formula_item_id', item.id).order('step_number'),
      item.group_key === 'drink'
        ? supabase.from('formula_item_sizes').select('size_id, drink_sizes(id, name, sort_order)').eq('formula_item_id', item.id)
        : Promise.resolve({ data: [] }),
      supabase.from('formula_item_annotations').select('*').eq('formula_item_id', item.id).order('sort_order'),
      supabase.from('formula_item_videos').select('*').eq('formula_item_id', item.id).order('sort_order'),
    ]).then(([ingRes, stepRes, sizeRes, annRes, videoRes]) => {
      if (!active) return
      // Drop rows where no ingredient was ever picked (a "+ Add ingredient"
      // row left blank in Edit Item) — these used to show up as their own
      // column/chip labelled literally "Ingredient" with nothing in it.
      setAllIngredients((ingRes.data ?? []).filter((ing) => ing.ingredient_id))
      setSteps(stepRes.data ?? [])
      const sizeList = (sizeRes.data ?? [])
        .map((r) => r.drink_sizes)
        .filter(Boolean)
        .sort((a, b) => a.sort_order - b.sort_order)
      setSizes(sizeList)
      const annotations = annRes.data ?? []
      setAnnotationsAbove(annotations.filter((a) => a.position === 'above'))
      setAnnotationsBelow(annotations.filter((a) => a.position !== 'above'))
      setVideos(videoRes.data ?? [])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [item])

  // Steps that were added but never actually filled in (blank text, no
  // image) don't get a number shown to staff — see ItemEditModal, which
  // now skips saving these going forward. Existing blank ones just get
  // filtered out and the rest renumbered here so there's no gap.
  const visibleSteps = steps
    .filter((s) => stripHtml(s.instruction_html) || s.image_path)
    .map((s, idx) => ({ ...s, step_number: idx + 1 }))

  return (
    <Modal open={!!item} onClose={onClose} wide title={<ItemTitle item={item} />}>
      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-6">
          <section>
            <FormulaIngredientsView
              hasHotVersion={!!item?.has_hot_version}
              showHot={showHot}
              onToggleHot={setShowHot}
              displayMode={item?.display_mode}
              customImagePath={item?.custom_image_path}
              ingredients={allIngredients}
              sizes={sizes}
              annotationsAbove={annotationsAbove}
              annotationsBelow={annotationsBelow}
              notesHtml={item?.notes}
              notesImagePath={item?.notes_image_path}
              videos={videos}
            />
          </section>

          {/* Same rule as FormulaIngredientsView's Ingredients section (see
              its showIngredientsSection comment) — an item with genuinely no
              steps at all doesn't need a "Method" heading over a "No steps
              recorded." placeholder; that's just noise for e.g. a pure-
              ingredients item with no method written yet. */}
          {visibleSteps.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-brand-700">Method</h4>
              <ol className="space-y-3">
                {visibleSteps.map((s) => (
                  <li key={s.id} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">
                      {s.step_number}
                    </span>
                    <div className="flex-1">
                      <RichTextViewer html={s.instruction_html} />
                      {s.image_path && (
                        <MediaPreview
                          src={s.image_path}
                          alt={`Step ${s.step_number}`}
                          className="mt-1 max-w-xs rounded-lg border border-gray-200"
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}

function ItemTitle({ item }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex items-center gap-1">
        {item?.name_en}
        <PronounceButton text={item?.name_en} lang="en-AU" />
      </span>
      {item?.name_zh && (
        <span className="flex items-center gap-1 text-brand-600 font-zh">
          · {item.name_zh}
          <PronounceButton text={item.name_zh} />
        </span>
      )}
    </span>
  )
}
