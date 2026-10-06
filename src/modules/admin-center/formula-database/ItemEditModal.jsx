import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import IngredientPicker from './IngredientPicker'
import FormulaIngredientsView from '../../operations-training/formula/FormulaIngredientsView'
import MediaPreview from '../../../components/ui/MediaPreview'
import { getMediaKind } from '../../../lib/mediaType'
import FileRepositoryPicker from '../../../components/ui/FileRepositoryPicker'

async function uploadImage(file, pathPrefix) {
  const path = `${pathPrefix}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage.from('formula-images').upload(path, file, { upsert: true })
  if (error) throw error
  return supabase.storage.from('formula-images').getPublicUrl(path).data.publicUrl
}

// Jeff, 2026-10-02: "admin centre裡的formula...add image/video旁都新增
// '+ from file repository'" — every upload point on this page stores a
// full public URL (the `formula-images` bucket, unlike File Repository's
// own bucket-relative paths), so picking an existing File Repository file
// here needs converting to that same full-URL shape before it can slot
// into customImagePath/step.image_path/notesImagePath/video.url.
function fileRepositoryUrl(file) {
  return supabase.storage.from('documents').getPublicUrl(file.file_path).data.publicUrl
}

// A handful of save() steps (delete-then-reinsert for ingredients,
// annotations, steps, stores, sizes) used to fire without checking the
// response — a failed insert (e.g. a table missing its RLS policy) would
// silently no-op instead of surfacing through the catch/alert below, so a
// save could report success while actually dropping data. Every one of
// those calls now goes through this so a real Postgres error always throws.
async function run(promise) {
  const { error } = await promise
  if (error) throw error
}

// A step added via "+ Add step" but never actually typed into (or given an
// image) shouldn't be saved — it used to show up to staff as a bare numbered
// circle with nothing next to it ("Method: 1" and nothing else).
function stepHasContent(step) {
  return !!(step.instruction_html || '').replace(/<[^>]*>/g, '').trim() || !!step.image_path
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim()
}

export default function ItemEditModal({ item, nextSortOrder, onClose, onSaved }) {
  const { profile, accessibleStores } = useAuth()
  const isNew = !item.id
  const isDrink = item.group_key === 'drink'
  const [nameEn, setNameEn] = useState(item.name_en ?? '')
  const [nameZh, setNameZh] = useState(item.name_zh ?? '')
  const [displayMode, setDisplayMode] = useState(item.display_mode ?? 'standard')
  const [customImagePath, setCustomImagePath] = useState(item.custom_image_path ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [notesImagePath, setNotesImagePath] = useState(item.notes_image_path ?? '')
  const [availableSizes, setAvailableSizes] = useState([])
  const [selectedSizeIds, setSelectedSizeIds] = useState([])
  const [activeSizeTab, setActiveSizeTab] = useState(null)
  const [hasHotVersion, setHasHotVersion] = useState(item.has_hot_version ?? false)
  // Drink-only: shows this item, on top of its own category, gathered
  // together under a synthetic "Top 10" category on the staff Formula page
  // and in the Study Log drink filter (see FormulaPage.jsx/StudyLogList.jsx).
  // It's just this one boolean flag, not a real formula_categories row, so
  // the item never actually leaves its own category.
  const [topTen, setTopTen] = useState(item.top_10 ?? false)
  // Jeff, 2026-09-30: "formula編輯頁面在top10勾取下面新增menu item" -- a
  // second, independent flag: which items are the store's official
  // required-memorization list (used to sort/tag them in the Formula list
  // and to scope Quick/Formal Quiz's fill-in-the-blank pool and the Formal
  // Quiz manager-approval "not yet memorized" check -- see
  // ItemManager.jsx/FormulaPage.jsx/QuickQuizModal.jsx/FormalQuizModal.jsx/
  // StaffStudyDetail.jsx). Renamed the same day, before ever shipping, from
  // "Menu item" to "Must-Know Items" (Jeff: "將勾選menu item改成
  // "Must-Know Items""), tagged with a star instead of a text badge in the
  // Formula lists, and extended to Study Log's tab/dropdown + Progress
  // Chart/Study Summary. A non-must-know item stays fully visible and
  // keeps its own Study Log "Memorized" self-tracking checkbox; it's just
  // no longer mandatory. Originally drink-only (migration 0081's
  // constraint); Jeff, 2026-10-03: "Tea, topping跟others也要有must-know
  // item標示" -- opened up to every group_key (top_10 stays drink-only).
  const [mustKnow, setMustKnow] = useState(item.is_must_know ?? false)
  // Jeff, 2026-10-07: "Must Appear in Exam的選項從商品編輯移除，重要的題目
  // 標註important 1就好" — the per-item "guarantee a slot" flag (migration
  // 0093's must_appear_in_exam) is retired; mark the QUESTION itself
  // importance 1 instead (Admin Quiz Bank / shop Quiz Bank's question
  // editor), which Formal Exam's importance-ratio sampling already weights
  // toward. The DB column is left in place, unused — same as every other
  // retired flag this session (e.g. Training Code), nothing reads it any
  // more.
  // Jeff, 2026-10-07 (migration 0093): pulls this item out of the
  // staff-facing Formula page entirely (every list there, plus the Update
  // tab/badge) and out of Admin Training Journey Setting's phase-assign
  // lists and the Training Journey phase checklists — see
  // FormulaPage.jsx/formulaUpdates.js/PhaseItemTab.jsx/trainingJourney.js.
  // Its own training_journey_phase value is left untouched in the DB, so
  // un-hiding it later restores it to wherever it already was assigned.
  // ItemManager.jsx (this item's own admin list) still shows it, just
  // dimmed, so it stays findable.
  const [hideFromFormula, setHideFromFormula] = useState(item.hide_from_formula ?? false)
  const [activeHot, setActiveHot] = useState(false) // which ingredient set is showing: false = Iced/Cold, true = Hot
  const [ingredients, setIngredients] = useState([])
  const [annotations, setAnnotations] = useState([]) // small notes shown just above/below the table on the Formula page
  const [videos, setVideos] = useState([]) // titled videos — a drink or shop-training item can have more than one
  const [steps, setSteps] = useState([])
  const [visibleStoreIds, setVisibleStoreIds] = useState(null) // null = all stores
  const [saving, setSaving] = useState(false)
  // Which "+ from file repository" picker is currently open, if any — only
  // one at a time, so a single bit of state covers all four insertion
  // points (custom image, a step's media by index, notes media, a video
  // row's media by key) instead of one boolean per field/row.
  const [picking, setPicking] = useState(null) // null | 'custom' | 'notes' | {type:'step', idx} | {type:'video', key}
  const [ingredientMasterMap, setIngredientMasterMap] = useState(new Map()) // id -> {name, unit, ingredient_format_rules} — only for the live Preview

  // Drink-only: the shop-wide list of sizes to choose from (Admin Center >
  // Formula Database > Drink Sizes).
  useEffect(() => {
    if (!isDrink) return
    supabase
      .from('drink_sizes')
      .select('*')
      .order('sort_order')
      .then(({ data }) => setAvailableSizes(data ?? []))
  }, [isDrink])

  // Every ingredient's name + Format Rule, once — used only to render the
  // live Preview panel exactly how the Formula page will look (that page
  // joins ingredient_master itself; here we already have the ids in local
  // form state and just need the same lookup to draw the same chips/table).
  useEffect(() => {
    Promise.all([
      supabase.from('ingredient_master').select('id, name, unit'),
      supabase.from('ingredient_format_rules').select('*'),
    ]).then(([{ data: masters }, { data: rules }]) => {
      const ruleByIngredientId = new Map((rules ?? []).map((r) => [r.ingredient_id, r]))
      const map = new Map(
        (masters ?? []).map((m) => [m.id, { name: m.name, unit: m.unit, ingredient_format_rules: ruleByIngredientId.get(m.id) }])
      )
      setIngredientMasterMap(map)
    })
  }, [])

  useEffect(() => {
    if (isNew) return
    supabase
      .from('formula_item_ingredients')
      .select('*')
      .eq('formula_item_id', item.id)
      .order('sort_order')
      .then(({ data }) => setIngredients(data ?? []))
    supabase
      .from('formula_item_annotations')
      .select('*')
      .eq('formula_item_id', item.id)
      .order('sort_order')
      .then(({ data }) => setAnnotations(data ?? []))
    supabase
      .from('formula_item_videos')
      .select('*')
      .eq('formula_item_id', item.id)
      .order('sort_order')
      .then(({ data }) => setVideos(data ?? []))
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
    if (isDrink) {
      supabase
        .from('formula_item_sizes')
        .select('size_id')
        .eq('formula_item_id', item.id)
        .then(({ data }) => setSelectedSizeIds((data ?? []).map((r) => r.size_id)))
    }
  }, [item.id])

  const usesSizes = isDrink && selectedSizeIds.length > 0
  const currentTab = activeSizeTab ?? selectedSizeIds[0] ?? null
  const visibleIngredients = ingredients.filter(
    (ing) => (!usesSizes || ing.size_id === currentTab) && (!hasHotVersion || !!ing.is_hot === activeHot)
  )

  // Preview always shows every size at once (that's how the Formula page's
  // matrix works — it isn't tabbed by size), filtered only by Iced/Cold vs
  // Hot, same toggle as the editing tabs above so flipping it updates both
  // what you're editing and what the preview shows together.
  const previewIngredients = ingredients
    .filter((ing) => ing.ingredient_id)
    .map((ing) => ({ ...ing, ingredient_master: ingredientMasterMap.get(ing.ingredient_id) }))
  const previewSizes = availableSizes.filter((s) => selectedSizeIds.includes(s.id))
  const annotationsAbove = annotations.filter((a) => a.position === 'above')
  const annotationsBelow = annotations.filter((a) => a.position !== 'above')

  function toggleHasHotVersion() {
    setHasHotVersion((prev) => {
      const next = !prev
      if (!next) {
        // Turning it off — drop the Hot ingredient rows too, otherwise
        // they'd linger in state with no tab left to show them.
        setIngredients((rows) => rows.filter((r) => !r.is_hot))
        setActiveHot(false)
      }
      return next
    })
  }

  function toggleSize(sizeId) {
    const isRemoving = selectedSizeIds.includes(sizeId)
    if (isRemoving) {
      // Drop that size's ingredient rows too — otherwise they'd linger in
      // state as orphans no tab ever shows again.
      setIngredients((prev) => prev.filter((ing) => ing.size_id !== sizeId))
      if (activeSizeTab === sizeId) setActiveSizeTab(null)
      setSelectedSizeIds((prev) => prev.filter((id) => id !== sizeId))
    } else {
      setActiveSizeTab(sizeId)
      setSelectedSizeIds((prev) => [...prev, sizeId])
    }
  }

  function addIngredient() {
    const sizeId = usesSizes ? currentTab : null
    setIngredients((prev) => [
      ...prev,
      {
        _key: Math.random(),
        ingredient_id: '',
        quantity_text: '',
        size_id: sizeId,
        is_hot: hasHotVersion && activeHot,
        group_label: '',
        sort_order: prev.length,
      },
    ])
  }
  function updateIngredient(key, patch) {
    setIngredients((prev) => {
      let next = prev.map((r) => ((r._key ?? r.id) === key ? { ...r, ...patch } : r))
      const row = next.find((r) => (r._key ?? r.id) === key)
      if (!usesSizes || !row?.size_id || !row.ingredient_id) return next

      // Which occurrence this row is among same-ingredient rows in its OWN
      // size — 1st Sugar, 2nd Sugar, etc. Both kinds of mirroring below
      // target this same occurrence# in every other size, so adding the
      // same ingredient a second time (e.g. sugar added twice) mirrors its
      // own 2nd row too, instead of matching/skipping against the 1st.
      const sameSizeMatches = next.filter(
        (r) => r.size_id === row.size_id && r.ingredient_id === row.ingredient_id && !!r.is_hot === !!row.is_hot
      )
      const occurrenceIndex = sameSizeMatches.findIndex((r) => (r._key ?? r.id) === key)

      // Picking an ingredient for one size mirrors it into every other size
      // this item offers — M/L/XL almost always use the same ingredient
      // list and only the quantity differs, so this saves re-adding every
      // ingredient per size by hand. The mirrored row starts with a blank
      // quantity and can be freely retyped or removed afterward; a size is
      // only skipped once it already has a row at this same occurrence, so
      // it doesn't pile up duplicates every time an existing row is edited.
      if (patch.ingredient_id) {
        const missingSizeIds = selectedSizeIds.filter((sid) => {
          if (sid === row.size_id) return false
          const targetMatches = next.filter(
            (r) => r.size_id === sid && r.ingredient_id === row.ingredient_id && !!r.is_hot === !!row.is_hot
          )
          return targetMatches.length <= occurrenceIndex
        })
        if (missingSizeIds.length) {
          next = [
            ...next,
            ...missingSizeIds.map((sid) => ({
              _key: Math.random(),
              ingredient_id: row.ingredient_id,
              quantity_text: '',
              size_id: sid,
              is_hot: row.is_hot,
              group_label: row.group_label,
              sort_order: next.length,
            })),
          ]
        }
      }

      // The Group box (boxes ingredients together on the Formula page)
      // should match across sizes too, same as the ingredient itself —
      // only the quantity is meant to be typed per size. This updates
      // whichever sibling row already lines up at the same occurrence,
      // wherever one already exists; it never creates a row by itself.
      if (patch.group_label !== undefined) {
        const otherSizeIds = selectedSizeIds.filter((sid) => sid !== row.size_id)
        next = next.map((r) => {
          if (!otherSizeIds.includes(r.size_id) || r.ingredient_id !== row.ingredient_id || !!r.is_hot !== !!row.is_hot) {
            return r
          }
          const matches = next.filter(
            (x) => x.size_id === r.size_id && x.ingredient_id === row.ingredient_id && !!x.is_hot === !!row.is_hot
          )
          const idx = matches.findIndex((x) => (x._key ?? x.id) === (r._key ?? r.id))
          return idx === occurrenceIndex ? { ...r, group_label: patch.group_label } : r
        })
      }

      return next
    })
  }
  function removeIngredient(key) {
    setIngredients((prev) => prev.filter((r) => (r._key ?? r.id) !== key))
  }
  // Unlike picking an ingredient (updateIngredient, above) — which
  // deliberately mirrors into every other size, since M/L/XL almost always
  // share the same ingredient list — reordering is kept per-size only
  // (Jeff's request): moving a row up/down in one size's tab only changes
  // that size's own order, not any other size's. A size can genuinely want
  // its own display order (e.g. a step that matters more at one size than
  // another), so this no longer swaps the equivalent position in sibling
  // sizes the way it used to.
  function moveIngredient(key, direction) {
    setIngredients((prev) => {
      const row = prev.find((r) => (r._key ?? r.id) === key) || {}
      const rowGroupKey = `${row.size_id || ''}|${row.is_hot ? '1' : '0'}`
      const groupIndices = []
      prev.forEach((r, i) => {
        const gk = `${r.size_id || ''}|${r.is_hot ? '1' : '0'}`
        if (gk === rowGroupKey) groupIndices.push(i)
      })
      const posInGroup = groupIndices.findIndex((i) => (prev[i]._key ?? prev[i].id) === key)
      const swapWith = posInGroup + direction
      if (posInGroup === -1 || swapWith < 0 || swapWith >= groupIndices.length) return prev

      const next = [...prev]
      const a = groupIndices[posInGroup]
      const b = groupIndices[swapWith]
      ;[next[a], next[b]] = [next[b], next[a]]
      return next
    })
  }

  function addAnnotation(position) {
    setAnnotations((prev) => [...prev, { _key: Math.random(), position, text: '' }])
  }
  function updateAnnotation(key, patch) {
    setAnnotations((prev) => prev.map((a) => ((a._key ?? a.id) === key ? { ...a, ...patch } : a)))
  }
  function removeAnnotation(key) {
    setAnnotations((prev) => prev.filter((a) => (a._key ?? a.id) !== key))
  }

  function addVideo() {
    setVideos((prev) => [...prev, { _key: Math.random(), title: '', url: '' }])
  }
  function updateVideo(key, patch) {
    setVideos((prev) => prev.map((v) => ((v._key ?? v.id) === key ? { ...v, ...patch } : v)))
  }
  function removeVideo(key) {
    setVideos((prev) => prev.filter((v) => (v._key ?? v.id) !== key))
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
      const base = {
        name_en: nameEn,
        name_zh: nameZh,
        group_key: item.group_key,
        category_id: item.category_id ?? null,
        display_mode: displayMode,
        custom_image_path: displayMode === 'custom' ? customImagePath || null : null,
        notes: stripHtml(notes) ? notes : null,
        notes_image_path: notesImagePath || null,
        has_hot_version: isDrink ? hasHotVersion : false,
        top_10: isDrink ? topTen : false,
        is_must_know: mustKnow,
        hide_from_formula: hideFromFormula,
      }
      if (isNew) {
        const { data, error } = await supabase
          .from('formula_items')
          .insert({
            ...base,
            sort_order: nextSortOrder,
            created_by: profile.id,
            created_by_name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email,
          })
          .select()
          .single()
        if (error) throw error
        itemId = data.id
      } else {
        const { error } = await supabase.from('formula_items').update(base).eq('id', itemId)
        if (error) throw error
        await run(supabase.from('formula_item_ingredients').delete().eq('formula_item_id', itemId))
        await run(supabase.from('formula_item_annotations').delete().eq('formula_item_id', itemId))
        await run(supabase.from('formula_item_videos').delete().eq('formula_item_id', itemId))
        await run(supabase.from('formula_item_steps').delete().eq('formula_item_id', itemId))
        await run(supabase.from('formula_item_stores').delete().eq('formula_item_id', itemId))
        if (isDrink) await run(supabase.from('formula_item_sizes').delete().eq('formula_item_id', itemId))
      }

      // Skip rows where "+ Add ingredient" was clicked but no ingredient was
      // ever picked — these used to get saved anyway and show up on the
      // staff-facing Formula page as an empty "Ingredient" column.
      const nonEmptyIngredients = ingredients.filter((ing) => ing.ingredient_id)
      if (nonEmptyIngredients.length) {
        await run(
          supabase.from('formula_item_ingredients').insert(
            nonEmptyIngredients.map((ing, idx) => ({
              formula_item_id: itemId,
              ingredient_id: ing.ingredient_id,
              quantity_text: ing.quantity_text,
              size_id: ing.size_id || null,
              is_hot: !!ing.is_hot,
              group_label: ing.group_label || null,
              sort_order: idx,
            }))
          )
        )
      }
      const nonEmptyAnnotations = annotations.filter((a) => a.text.trim())
      if (nonEmptyAnnotations.length) {
        const aboveRows = nonEmptyAnnotations.filter((a) => a.position === 'above')
        const belowRows = nonEmptyAnnotations.filter((a) => a.position !== 'above')
        await run(
          supabase.from('formula_item_annotations').insert(
            [...aboveRows, ...belowRows].map((a, idx) => ({
              formula_item_id: itemId,
              position: a.position === 'above' ? 'above' : 'below',
              text: a.text.trim(),
              sort_order: idx,
            }))
          )
        )
      }
      const nonEmptyVideos = videos.filter((v) => v.url.trim())
      if (nonEmptyVideos.length) {
        await run(
          supabase.from('formula_item_videos').insert(
            nonEmptyVideos.map((v, idx) => ({
              formula_item_id: itemId,
              title: v.title?.trim() || null,
              url: v.url.trim(),
              sort_order: idx,
            }))
          )
        )
      }
      const nonEmptySteps = steps.filter(stepHasContent)
      if (nonEmptySteps.length) {
        await run(
          supabase.from('formula_item_steps').insert(
            nonEmptySteps.map((s, idx) => ({
              formula_item_id: itemId,
              step_number: idx + 1,
              instruction_html: s.instruction_html,
              image_path: s.image_path || null,
            }))
          )
        )
      }
      if (visibleStoreIds && visibleStoreIds.length) {
        await run(
          supabase.from('formula_item_stores').insert(visibleStoreIds.map((storeId) => ({ formula_item_id: itemId, store_id: storeId })))
        )
      }
      if (isDrink && selectedSizeIds.length) {
        await run(
          supabase.from('formula_item_sizes').insert(selectedSizeIds.map((sizeId) => ({ formula_item_id: itemId, size_id: sizeId })))
        )
      }
      onSaved()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <Modal
      open
      onClose={onClose}
      extraWide
      title={isNew ? 'New Item' : 'Edit Item'}
      footer={
        <Button onClick={save} disabled={saving || !nameEn}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
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

          {isDrink && (
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={topTen} onChange={(e) => setTopTen(e.target.checked)} />
              ⭐ Top 10
              <span className="text-xs font-normal text-gray-400">
                — also shows this drink under the Top 10 category, on top of its own category
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={mustKnow} onChange={(e) => setMustKnow(e.target.checked)} />
            ⭐ Must Know Item
            <span className="text-xs font-normal text-gray-400">
              — sorts above non-must-know items and gets a ⭐ tag; required for Quiz fill-in-the-blank and the
              Formal Quiz memorization check (a non-must-know item stays optional to memorize)
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={hideFromFormula} onChange={(e) => setHideFromFormula(e.target.checked)} />
            🙈 Hide from Formula
            <span className="text-xs font-normal text-gray-400">
              — removes this item from the staff Formula page and from Training Journey's phase assignment; it still
              shows here (dimmed) so you can find it again
            </span>
          </label>

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
            <h4 className="mb-2 text-sm font-semibold text-brand-700">Display</h4>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" name="display_mode" checked={displayMode === 'standard'} onChange={() => setDisplayMode('standard')} />
                Standard (ingredient chips)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" name="display_mode" checked={displayMode === 'custom'} onChange={() => setDisplayMode('custom')} />
                Custom image
              </label>
              {displayMode === 'custom' && (
                <>
                  <label className="cursor-pointer rounded-lg border border-brand-300 px-2 py-1 text-xs text-brand-700">
                    {customImagePath ? 'Change image' : 'Upload'}
                    <input
                      type="file"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files[0]
                        if (!f) return
                        const url = await uploadImage(f, 'items')
                        setCustomImagePath(url)
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setPicking('custom')}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    + from file repository
                  </button>
                </>
              )}
            </div>
            {displayMode === 'custom' && customImagePath && (
              <img src={customImagePath} alt="" className="mt-2 max-w-xs rounded-lg border border-gray-200" />
            )}
          </section>

          {isDrink && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-brand-700">Sizes</h4>
              {!availableSizes.length ? (
                <p className="text-sm text-gray-400">
                  No sizes set up yet — add some in Admin Center &gt; Formula Database &gt; Drink Sizes.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {availableSizes.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-sm text-gray-600">
                      <input type="checkbox" checked={selectedSizeIds.includes(s.id)} onChange={() => toggleSize(s.id)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Leave all unchecked for one formula. Check one or more to give each size its own ingredient list below.
              </p>
              <label className="mt-3 flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" checked={hasHotVersion} onChange={toggleHasHotVersion} />
                Has a Hot version
              </label>
              <p className="mt-1 text-xs text-gray-400">
                Staff pick Iced/Cold or Hot on the Formula page — one item, not two, so it doesn't clutter the category
                list. Only the ingredients differ; Method (steps) stays shared.
              </p>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-brand-700">Ingredients</h4>
              <Button variant="secondary" onClick={addIngredient}>
                + Add ingredient
              </Button>
            </div>
            {hasHotVersion && (
              <div className="mb-2 flex w-fit gap-1 rounded-lg border border-orange-200 bg-orange-50 p-1">
                <button
                  onClick={() => setActiveHot(false)}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    !activeHot ? 'bg-white text-orange-700 shadow-sm' : 'text-orange-500'
                  }`}
                >
                  Iced/Cold
                </button>
                <button
                  onClick={() => setActiveHot(true)}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    activeHot ? 'bg-white text-orange-700 shadow-sm' : 'text-orange-500'
                  }`}
                >
                  Hot
                </button>
              </div>
            )}
            {usesSizes && (
              <div className="mb-2 flex w-fit gap-1 rounded-lg border border-brand-200 bg-brand-50 p-1">
                {selectedSizeIds.map((sizeId) => {
                  const s = availableSizes.find((a) => a.id === sizeId)
                  return (
                    <button
                      key={sizeId}
                      onClick={() => setActiveSizeTab(sizeId)}
                      className={`rounded-md px-3 py-1 text-xs font-medium ${
                        currentTab === sizeId ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
                      }`}
                    >
                      {s?.name ?? '?'}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="space-y-2">
              {visibleIngredients.map((ing, idx) => {
                const key = ing._key ?? ing.id
                return (
                  <div key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
                    <div className="flex shrink-0 flex-col">
                      <button
                        onClick={() => moveIngredient(key, -1)}
                        disabled={idx === 0}
                        className="leading-none text-gray-400 hover:text-brand-600 disabled:pointer-events-none disabled:opacity-20"
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveIngredient(key, 1)}
                        disabled={idx === visibleIngredients.length - 1}
                        className="leading-none text-gray-400 hover:text-brand-600 disabled:pointer-events-none disabled:opacity-20"
                        title="Move down"
                      >
                        ▼
                      </button>
                    </div>
                    <IngredientPicker
                      className="min-w-0 flex-1"
                      value={ing.ingredient_id}
                      onChange={(id) => updateIngredient(key, { ingredient_id: id })}
                    />
                    <div className="w-20 shrink-0">
                      <input
                        className="input"
                        placeholder="Qty e.g. 30g"
                        value={ing.quantity_text}
                        onChange={(e) => updateIngredient(key, { quantity_text: e.target.value })}
                      />
                    </div>
                    <div className="w-24 shrink-0">
                      <input
                        className="input"
                        placeholder="Group"
                        title="Ingredients sharing the same Group get boxed together on the Formula page (e.g. 'Blender')"
                        value={ing.group_label || ''}
                        onChange={(e) => updateIngredient(key, { group_label: e.target.value })}
                      />
                    </div>
                    <button onClick={() => removeIngredient(key)} className="text-gray-400 hover:text-red-500">
                      ✕
                    </button>
                  </div>
                )
              })}
              {(usesSizes || hasHotVersion) && !visibleIngredients.length && (
                <p className="text-sm text-gray-400">No ingredients for {activeHot ? 'the Hot version' : 'this'}{usesSizes ? ' size' : ''} yet.</p>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Use ▲▼ to reorder — this is the order ingredients show in on the Formula page.
              {usesSizes && ' Reordering applies to every size (M/L…) together, since it’s the same drink.'}
              {hasHotVersion && ' Iced/Cold and Hot keep their own separate order, since they’re often different formulas.'}
              {' '}Give two or more ingredients the same Group (e.g. "Blender") to box them together — see the Preview.
            </p>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-brand-700">Ingredient table notes</h4>
            <p className="mb-2 text-xs text-gray-400">
              Small call-outs shown right above or below the ingredient table/chips — for things like a unit
              clarification or "N.I = no ice mark". For anything longer, use Notes further down instead.
            </p>
            <AnnotationList
              label="Above the table"
              position="above"
              items={annotationsAbove}
              onAdd={() => addAnnotation('above')}
              onChange={updateAnnotation}
              onRemove={removeAnnotation}
            />
            <div className="mt-3">
              <AnnotationList
                label="Below the table"
                position="below"
                items={annotationsBelow}
                onAdd={() => addAnnotation('below')}
                onChange={updateAnnotation}
                onRemove={removeAnnotation}
              />
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
                        {s.image_path ? 'Change image/video' : 'Add image/video'}
                        <input
                          type="file"
                          accept="image/*,video/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files[0]
                            if (!f) return
                            const url = await uploadImage(f, 'steps')
                            updateStep(idx, { image_path: url })
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setPicking({ type: 'step', idx })}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        + from file repository
                      </button>
                      <button onClick={() => removeStep(idx)} className="text-gray-400 hover:text-red-500">
                        ✕
                      </button>
                    </div>
                  </div>
                  <SimpleRichTextEditor value={s.instruction_html} onChange={(v) => updateStep(idx, { instruction_html: v })} />
                  {/* An uploaded image already shows right below via MediaPreview —
                      there's nothing to link to, so this box only needs to appear
                      for the video case: no attachment yet (so a link can be pasted
                      instead of uploading a file), or an attachment that's already a
                      video/external link (so it can still be edited). */}
                  {getMediaKind(s.image_path) !== 'image' && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="shrink-0 text-[11px] text-gray-400">or video link:</span>
                      <input
                        type="text"
                        className="input flex-1"
                        placeholder="https://... (a video already in your file repository, YouTube, etc.)"
                        value={s.image_path || ''}
                        onChange={(e) => updateStep(idx, { image_path: e.target.value })}
                      />
                    </div>
                  )}
                  {s.image_path && (
                    <MediaPreview
                      src={s.image_path}
                      alt={`Step ${idx + 1}`}
                      className="mt-2 max-w-xs rounded-lg border border-gray-200"
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-brand-700">Notes (optional)</h4>
              <div className="flex items-center gap-3">
                <label className="cursor-pointer text-xs text-brand-600 hover:underline">
                  {notesImagePath ? 'Change image/video' : '+ Add image/video'}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files[0]
                      if (!f) return
                      const url = await uploadImage(f, 'notes')
                      setNotesImagePath(url)
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setPicking('notes')}
                  className="text-xs text-brand-600 hover:underline"
                >
                  + from file repository
                </button>
              </div>
            </div>
            <p className="mb-1 text-xs text-gray-400">
              For things that aren't really an ingredient/quantity — a mixing ratio, "see table", a clarifying footnote.
              Shown as a small note under the ingredients on the Formula page. Attach an image or a short how-to video
              instead/as well for things that are easier to show than type out (a reference chart, an unusual layout,
              a made-in-house tutorial clip, etc).
            </p>
            <SimpleRichTextEditor value={notes} onChange={setNotes} placeholder="e.g. TA mash = 1.5 topping" />
            {notesImagePath && (
              <div className="mt-2 flex items-start gap-2">
                <MediaPreview src={notesImagePath} alt="" className="max-w-xs rounded-lg border border-gray-200" />
                <button
                  onClick={() => setNotesImagePath('')}
                  className="mt-1 text-xs text-gray-400 hover:text-red-500"
                  title="Remove image"
                >
                  ✕ Remove
                </button>
              </div>
            )}
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-brand-700">Videos (optional)</h4>
              <Button variant="secondary" onClick={addVideo}>
                + Add video
              </Button>
            </div>
            <p className="mb-2 text-xs text-gray-400">
              Attach one or more instructional videos, each with its own short title — e.g. a "Blending" clip and a
              separate "Garnish" clip for the same drink. Paste a link (from File Repository, YouTube, etc. — the
              same link can be reused across multiple drinks) or upload a file directly.
            </p>
            <div className="space-y-2">
              {videos.map((v) => {
                const key = v._key ?? v.id
                return (
                  <div key={key} className="rounded-lg border border-gray-200 p-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <input
                        className="input flex-1"
                        placeholder="Title (e.g. Blending steps)"
                        value={v.title || ''}
                        onChange={(e) => updateVideo(key, { title: e.target.value })}
                      />
                      <label className="shrink-0 cursor-pointer text-xs text-brand-600 hover:underline">
                        Upload
                        <input
                          type="file"
                          accept="video/*,image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files[0]
                            if (!f) return
                            const url = await uploadImage(f, 'videos')
                            updateVideo(key, { url })
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setPicking({ type: 'video', key })}
                        className="shrink-0 text-xs text-brand-600 hover:underline"
                      >
                        + from file repository
                      </button>
                      <button onClick={() => removeVideo(key)} className="shrink-0 text-gray-400 hover:text-red-500">
                        ✕
                      </button>
                    </div>
                    <input
                      type="text"
                      className="input w-full"
                      placeholder="https://... (paste a link, or use Upload above)"
                      value={v.url || ''}
                      onChange={(e) => updateVideo(key, { url: e.target.value })}
                    />
                    {v.url && (
                      <a href={v.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-600 hover:underline">
                        ▶ Test link
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <div className="lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-500">Preview — Formula page</p>
            <div className="rounded-lg bg-white p-3">
              <FormulaIngredientsView
                hasHotVersion={hasHotVersion}
                showHot={activeHot}
                onToggleHot={setActiveHot}
                displayMode={displayMode}
                customImagePath={customImagePath}
                ingredients={previewIngredients}
                sizes={previewSizes}
                annotationsAbove={annotationsAbove.filter((a) => a.text.trim())}
                annotationsBelow={annotationsBelow.filter((a) => a.text.trim())}
                notesHtml={notes}
                notesImagePath={notesImagePath}
                videos={videos.filter((v) => v.url.trim())}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
    {picking && (
      <FileRepositoryPicker
        accept={picking === 'custom' ? 'image' : 'media'}
        onSelect={(f) => {
          const url = fileRepositoryUrl(f)
          if (picking === 'custom') setCustomImagePath(url)
          else if (picking === 'notes') setNotesImagePath(url)
          else if (picking.type === 'step') updateStep(picking.idx, { image_path: url })
          else if (picking.type === 'video') updateVideo(picking.key, { url })
          setPicking(null)
        }}
        onClose={() => setPicking(null)}
      />
    )}
    </>
  )
}

function AnnotationList({ label, items, onAdd, onChange, onRemove }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        <button onClick={onAdd} className="text-xs text-brand-600 hover:underline">
          + Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-300">None yet.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((a) => {
            const key = a._key ?? a.id
            return (
              <div key={key} className="flex items-center gap-2">
                <input
                  className="input flex-1 text-sm"
                  value={a.text}
                  onChange={(e) => onChange(key, { text: e.target.value })}
                  placeholder="e.g. N.I = fill to the No Ice mark"
                />
                <button onClick={() => onRemove(key)} className="text-gray-400 hover:text-red-500">
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
