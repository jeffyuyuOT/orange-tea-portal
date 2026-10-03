import { supabase } from './supabaseClient'
import { filterVisibleForStore } from './storeVisibility'
import { weightedSample } from './quizSelection'
import { buildHardQuantityChoiceQuestion } from './formulaChoiceQuestion'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Jeff, 2026-10-04 (migration 0093): "formula跟shop training的商品編輯頁面，
// 出現必出勾選，勾選的話在formal exam, 和expert/master exam為必出考題" — an
// item flagged `must_appear_in_exam` (formula_items or shop_training_items)
// gets at least one of its linked questions guaranteed a slot, instead of
// leaving it purely to chance in the shuffle().slice() every exam builder
// below already ends with. Deliberately not used by buildLevelUpExamQuestionSet
// — Jeff only named Formal/Expert/Master.
//
// `candidates` can mix two shapes: raw quiz_questions bank rows (spread in
// as-is elsewhere in this file, so the link is the snake_case
// `formula_item_id`/`shop_training_item_id` columns) and the Formal Exam's
// own locally-generated fill-blank candidates (camelCase `formulaItemId`,
// no shop-training equivalent — those are always built from a formula
// item's ingredients). Checking both naming conventions here lets every
// builder reuse this one helper rather than re-shaping its pools first.
// Only one candidate per flagged item is forced (the first hit in whatever
// order `candidates` is already in — callers pass a pre-shuffled array so
// this isn't biased toward whichever question was created first) since the
// point is "this item gets asked about", not "every question about it".
function splitForced(candidates, mustAppearFormulaIds, mustAppearTrainingIds) {
  const forced = []
  const rest = []
  const seen = new Set()
  for (const c of candidates) {
    const formulaId = c.formula_item_id ?? c.formulaItemId ?? null
    const trainingId = c.shop_training_item_id ?? c.shopTrainingItemId ?? null
    const key =
      formulaId && mustAppearFormulaIds.has(formulaId)
        ? `f:${formulaId}`
        : trainingId && mustAppearTrainingIds.has(trainingId)
          ? `t:${trainingId}`
          : null
    if (key && !seen.has(key)) {
      seen.add(key)
      forced.push(c)
    } else {
      rest.push(c)
    }
  }
  return { forced, rest }
}

// Shared tail end for Master/Expert (and, inline, Formal): guarantee every
// forced candidate a slot, then fill whatever's left of questionCount from
// the (already-shuffled) rest — never the other way around, so a forced
// item can never be bumped by the random slice.
function combineWithForced(forced, rest, questionCount) {
  const remaining = Math.max(0, questionCount - forced.length)
  return shuffle([...forced, ...shuffle(rest).slice(0, remaining)])
}

// Formal Exam question set — shared by the real Formal Exam (initial
// qualification, manager-reviewed; and the recurring Advanced title-defense
// re-sit, self-graded) AND Take a Quiz's "Mock Formal Quiz" practice mode.
// Ported from the old FormalQuizModal.jsx, with one Training Journey change:
// the multiple-choice/bank pool is now narrowed to MUST-KNOW memorized items
// only, same as the fill-in-the-blank pool already was — Jeff's spec says
// the real Formal Exam "都只會從must-know item出題" with no tolerance
// concept, so every item-linked question in this set is must-know, and an
// attempt simply needs every question correct to self-grade as a pass. A
// bank question with no linked formula item (a cross-drink concept
// question) stays unrestricted, same as before — it isn't "from" any one
// item, must-know or not.
export async function buildFormalExamQuestionSet(profileId, storeId) {
  const { data: memorized } = await supabase.from('study_progress').select('formula_item_id').eq('profile_id', profileId).eq('memorized', true)
  let memorizedIds = (memorized ?? []).map((m) => m.formula_item_id)
  if (!memorizedIds.length) return { questions: [], reason: 'no_memorized' }

  const { data: drinkStoreRows } = await supabase.from('formula_item_stores').select('*').in('formula_item_id', memorizedIds)
  memorizedIds = filterVisibleForStore(memorizedIds.map((id) => ({ id })), drinkStoreRows ?? [], 'formula_item_id', storeId).map((i) => i.id)
  if (!memorizedIds.length) return { questions: [], reason: 'no_questions' }

  const { data: settings } = await supabase.from('formal_quiz_settings').select('*').maybeSingle()
  const questionCount = settings?.question_count ?? 30
  const ratio = settings?.importance_ratio ?? { 1: 50, 2: 30, 3: 20 }
  const fillBlankRatio = settings?.fill_in_blank_ratio ?? 20
  const top10Weight = settings?.top10_fill_blank_weight ?? 3

  const { data: itemFlagRows } = await supabase
    .from('formula_items')
    .select('id, top_10, is_must_know, must_appear_in_exam')
    .in('id', memorizedIds)
  const top10Ids = new Set((itemFlagRows ?? []).filter((r) => r.top_10).map((r) => r.id))
  const mustKnowIds = new Set((itemFlagRows ?? []).filter((r) => r.is_must_know).map((r) => r.id))
  const mustKnowMemorizedIds = memorizedIds.filter((id) => mustKnowIds.has(id))
  // Must Appear in Exam (migration 0093): formula side is scoped to this
  // staff member's own memorized items (itemFlagRows, above) — a flagged
  // item they haven't memorized yet simply has no eligible question to
  // force here, same as it has none for the rest of this pool. Shop
  // training's flag isn't gated by memorization anywhere in this function
  // (it never tracked that), so it's fetched store-wide instead.
  const mustAppearFormulaIds = new Set((itemFlagRows ?? []).filter((r) => r.must_appear_in_exam).map((r) => r.id))
  const { data: trainingMustAppearRows } = storeId
    ? await supabase.from('shop_training_items').select('id').eq('store_id', storeId).eq('must_appear_in_exam', true)
    : { data: [] }
  const mustAppearTrainingIds = new Set((trainingMustAppearRows ?? []).map((r) => r.id))

  const [{ data: ingredientRows }, { data: excludedRows }, { data: allQuantityRows }, { data: sizedItemRows }] = await Promise.all([
    supabase
      .from('formula_item_ingredients')
      .select(
        'id, ingredient_id, quantity_text, is_hot, size_id, group_label, ingredient_master(name), formula_items!inner(id, name_en, name_zh, is_must_know), drink_sizes(name)'
      )
      .in('formula_item_id', memorizedIds)
      .not('ingredient_id', 'is', null),
    supabase.from('quiz_excluded_ingredients').select('ingredient_id'),
    supabase
      .from('formula_item_ingredients')
      .select('ingredient_id, quantity_text')
      .not('quantity_text', 'is', null)
      .not('ingredient_id', 'is', null)
      .neq('quantity_text', ''),
    supabase.from('formula_item_sizes').select('formula_item_id').in('formula_item_id', memorizedIds),
  ])
  const excludedIngredientIds = new Set((excludedRows ?? []).map((r) => r.ingredient_id))
  const sizedItemIds = new Set((sizedItemRows ?? []).map((r) => r.formula_item_id))
  const fillBlankCandidates = (ingredientRows ?? [])
    .filter(
      (r) =>
        r.quantity_text?.trim() &&
        r.ingredient_master?.name &&
        !r.is_hot &&
        !excludedIngredientIds.has(r.ingredient_id) &&
        r.formula_items?.is_must_know &&
        !(sizedItemIds.has(r.formula_item_id) && !r.size_id)
    )
    .map((r) => {
      const sizeSuffix = r.drink_sizes?.name ? ` (${r.drink_sizes.name})` : ''
      const groupSuffix = r.group_label ? ` (${r.group_label})` : ''
      const sugarSuffix = (r.ingredient_master.name ?? '').trim().toLowerCase() === 'sugar' ? ' (Full Sugar)' : ''
      return {
        type: 'fill_blank',
        isGenerated: true,
        localId: r.id,
        ingredientId: r.ingredient_id,
        quantityText: r.quantity_text.trim(),
        question: `${r.formula_items.name_en}${r.formula_items.name_zh ? ` · ${r.formula_items.name_zh}` : ''} — how much ${r.ingredient_master.name}${groupSuffix}${sizeSuffix}${sugarSuffix}?`,
        correctAnswer: r.quantity_text.trim(),
        topTen: top10Ids.has(r.formula_items.id),
        formulaItemId: r.formula_items.id,
      }
    })
  const realQuantityPool = {}
  ;(allQuantityRows ?? []).forEach((r) => {
    ;(realQuantityPool[r.ingredient_id] ??= new Set()).add(r.quantity_text)
  })

  const { data: candidateQuestions } = await supabase
    .from('quiz_questions')
    .select('*')
    .or(`store_id.is.null,store_id.eq.${storeId}`)
    .or(`formula_item_id.is.null,formula_item_id.in.(${mustKnowMemorizedIds.join(',') || 'null'})`)
  let mcVisible = []
  let bankFillBlankVisible = []
  if (candidateQuestions?.length) {
    mcVisible = candidateQuestions
      .filter((q) => (q.question_type ?? 'single') !== 'fill_blank')
      .map((q) => ({ type: q.question_type === 'multi' ? 'multi' : 'choice', localId: q.id, ...q }))
    bankFillBlankVisible = candidateQuestions
      .filter((q) => q.question_type === 'fill_blank')
      .map((q) => ({
        type: 'fill_blank',
        localId: q.id,
        id: q.id,
        question: q.question,
        correctAnswer: q.answer_text,
        acceptedAnswers: q.accepted_answers ?? [],
        image_path: q.image_path,
        topTen: top10Ids.has(q.formula_item_id),
        formulaItemId: q.formula_item_id,
        shopTrainingItemId: q.shop_training_item_id,
      }))
  }

  let allFillBlankCandidates = [...fillBlankCandidates, ...bankFillBlankVisible]
  if (!allFillBlankCandidates.length && !mcVisible.length) return { questions: [], reason: 'no_questions' }

  // Pull Must Appear in Exam candidates out of the full pools BEFORE any of
  // the quota/importance-ratio sampling below runs, so they're guaranteed a
  // slot rather than just getting lucky in it — then shrink the budget the
  // rest of this function samples for by however many got forced, and fold
  // them back in further down (fill-blank ones still need the same
  // hard-quantity-choice pass real fillBlankSelected items get, so they're
  // merged in before that, not just appended at the end). One combined
  // splitForced() call (rather than one per pool) so an item with BOTH a
  // generated fill-blank candidate and a bank MC question is only forced
  // once, not twice.
  const { forced: forcedQuestions, rest: nonForcedPool } = splitForced(
    shuffle([...allFillBlankCandidates, ...mcVisible]),
    mustAppearFormulaIds,
    mustAppearTrainingIds
  )
  const forcedFillBlank = forcedQuestions.filter((c) => c.type === 'fill_blank')
  const forcedMc = forcedQuestions.filter((c) => c.type !== 'fill_blank')
  allFillBlankCandidates = nonForcedPool.filter((c) => c.type === 'fill_blank')
  mcVisible = nonForcedPool.filter((c) => c.type !== 'fill_blank')
  const effectiveQuestionCount = Math.max(0, questionCount - forcedQuestions.length)

  let fillBlankTarget = Math.round((effectiveQuestionCount * fillBlankRatio) / 100)
  fillBlankTarget = Math.min(fillBlankTarget, allFillBlankCandidates.length)
  let mcTarget = effectiveQuestionCount - fillBlankTarget

  const fillBlankWeight = (c) => (c.topTen ? top10Weight : 1)
  let fillBlankSelected = [...forcedFillBlank, ...weightedSample(allFillBlankCandidates, fillBlankWeight, fillBlankTarget)]

  const fillBlankDrinkIds = new Set(fillBlankSelected.map((c) => c.formulaItemId).filter(Boolean))
  let mcSelected = [...forcedMc]
  const mcPool = mcVisible.filter((q) => !fillBlankDrinkIds.has(q.formula_item_id))

  const byImportance = { 1: [], 2: [], 3: [] }
  mcPool.forEach((q) => byImportance[q.importance]?.push(q))
  let mcPicked = []
  for (const level of [1, 2, 3]) {
    const target = Math.round((mcTarget * (ratio[level] ?? 0)) / 100)
    mcPicked.push(...shuffle(byImportance[level]).slice(0, target))
  }
  if (mcPicked.length < mcTarget) {
    const remaining = shuffle(mcPool.filter((q) => !mcPicked.includes(q))).slice(0, mcTarget - mcPicked.length)
    mcPicked.push(...remaining)
  }
  mcPicked = mcPicked.slice(0, mcTarget)
  // forcedMc was seeded into mcSelected above, ahead of this importance-
  // ratio sampling — appended here rather than capped by mcTarget with it,
  // so a forced item can't get sliced away by the quota the same way
  // fillBlankSelected's forced ones are kept outside fillBlankTarget too.
  mcSelected = [...mcSelected, ...mcPicked]

  // mcSelected/fillBlankSelected already include the forced items merged in
  // above, so the shortfall check compares against the real total
  // questionCount, not the forced-reduced effectiveQuestionCount budget
  // that only governed how much of each pool's quota sampling ran.
  const shortfall = questionCount - mcSelected.length - fillBlankSelected.length
  if (shortfall > 0) {
    const usedIds = new Set(fillBlankSelected.map((f) => f.localId))
    const extra = weightedSample(allFillBlankCandidates.filter((f) => !usedIds.has(f.localId)), fillBlankWeight, shortfall)
    fillBlankSelected = [...fillBlankSelected, ...extra]
  }

  fillBlankSelected = fillBlankSelected.map((q) => {
    if (!q.isGenerated || q.topTen) return q
    const built = buildHardQuantityChoiceQuestion({
      questionText: q.question,
      quantityText: q.quantityText,
      realPool: [...(realQuantityPool[q.ingredientId] ?? [])],
    })
    return built ? { ...q, type: 'choice', isGenerated: true, choices: built.choices, correct_choice: built.correct_choice } : q
  })

  const combined = shuffle([...mcSelected, ...fillBlankSelected]).slice(0, questionCount)
  return { questions: combined, reason: null }
}

// Master Exam question set — shared by the real Master Exam (initial +
// title-defense re-sit, both self-graded) AND Take a Quiz's "Mock Master
// Exam" practice mode. EVERY active/visible item (formula + shop training),
// not just memorized or must-know ones, per Jeff: "Master exam會從所有item
// 出題(不限定must-know item)". Each candidate question is tagged
// `isMustKnow` from its linked item (a question with no linked item at all
// — a cross-drink/cross-topic concept question — counts as NOT must-know,
// i.e. tolerable). The caller fails the attempt outright on any missed
// must-know question, regardless of error_tolerance; otherwise up to
// `errorTolerance` other misses are OK — see master_quiz_settings.
export async function buildMasterExamQuestionSet(storeId) {
  const [{ data: formulaItemRows }, { data: drinkStoreRows }, { data: trainingItemRows }, { data: settings }] = await Promise.all([
    supabase.from('formula_items').select('id, is_must_know, must_appear_in_exam').eq('is_active', true),
    supabase.from('formula_item_stores').select('*'),
    storeId
      ? supabase.from('shop_training_items').select('id, is_must_know, must_appear_in_exam').eq('store_id', storeId)
      : Promise.resolve({ data: [] }),
    supabase.from('master_quiz_settings').select('*').maybeSingle(),
  ])
  const visibleFormulaItems = filterVisibleForStore(formulaItemRows ?? [], drinkStoreRows ?? [], 'formula_item_id', storeId)
  const mustKnowFormulaIds = new Set(visibleFormulaItems.filter((i) => i.is_must_know).map((i) => i.id))
  const visibleFormulaIdSet = new Set(visibleFormulaItems.map((i) => i.id))
  const mustKnowTrainingIds = new Set((trainingItemRows ?? []).filter((i) => i.is_must_know).map((i) => i.id))
  const trainingIdSet = new Set((trainingItemRows ?? []).map((i) => i.id))
  const mustAppearFormulaIds = new Set(visibleFormulaItems.filter((i) => i.must_appear_in_exam).map((i) => i.id))
  const mustAppearTrainingIds = new Set((trainingItemRows ?? []).filter((i) => i.must_appear_in_exam).map((i) => i.id))

  const questionCount = settings?.question_count ?? 30
  const errorTolerance = settings?.error_tolerance ?? 0

  const { data: candidateQuestions } = await supabase.from('quiz_questions').select('*').or(`store_id.is.null,store_id.eq.${storeId}`)
  const filtered = (candidateQuestions ?? []).filter((q) => {
    if (q.formula_item_id) return visibleFormulaIdSet.has(q.formula_item_id)
    if (q.shop_training_item_id) return trainingIdSet.has(q.shop_training_item_id)
    return true
  })
  if (!filtered.length) return { questions: [], reason: 'no_questions', errorTolerance }

  const tagged = filtered.map((q) => ({
    ...q,
    localId: q.id,
    type: q.question_type === 'multi' ? 'multi' : q.question_type === 'fill_blank' ? 'fill_blank' : 'choice',
    isMustKnow: q.formula_item_id ? mustKnowFormulaIds.has(q.formula_item_id) : q.shop_training_item_id ? mustKnowTrainingIds.has(q.shop_training_item_id) : false,
  }))
  const { forced, rest } = splitForced(shuffle(tagged), mustAppearFormulaIds, mustAppearTrainingIds)
  const questions = combineWithForced(forced, rest, questionCount)
  return { questions, reason: null, errorTolerance }
}

// Level-Up Exam question set (phases 1-5) — must-know items across every
// phase UP TO AND INCLUDING the one being tested (Jeff: "level up exam會從
// 之前所有phase的內容出考題"). Plain multiple-choice/multi/fill-blank bank
// questions pooled the same way Master Exam's are (no fill-in-the-blank
// auto-generation here — the spec doesn't ask for it, and every question
// drawn is must-know by construction since only must-know items are ever
// assigned to a phase), each graded needing a perfect score to pass.
export async function buildLevelUpExamQuestionSet(storeId, upToPhase) {
  const [{ data: formulaItemRows }, { data: drinkStoreRows }, { data: trainingItemRows }, { data: phaseRows }] = await Promise.all([
    supabase.from('formula_items').select('id, training_journey_phase').eq('is_active', true).eq('is_must_know', true),
    supabase.from('formula_item_stores').select('*'),
    storeId
      ? supabase.from('shop_training_items').select('id, training_journey_phase').eq('store_id', storeId).eq('is_must_know', true)
      : Promise.resolve({ data: [] }),
    supabase.from('training_journey_phases').select('phase_number, level_up_exam_question_count').eq('phase_number', upToPhase).maybeSingle(),
  ])
  const visibleFormulaItems = filterVisibleForStore(formulaItemRows ?? [], drinkStoreRows ?? [], 'formula_item_id', storeId)
  const formulaIds = new Set(visibleFormulaItems.filter((i) => i.training_journey_phase && i.training_journey_phase <= upToPhase).map((i) => i.id))
  const trainingIds = new Set(
    (trainingItemRows ?? []).filter((i) => i.training_journey_phase && i.training_journey_phase <= upToPhase).map((i) => i.id)
  )
  if (!formulaIds.size && !trainingIds.size) return { questions: [], reason: 'no_questions' }

  const { data: candidateQuestions } = await supabase.from('quiz_questions').select('*').or(`store_id.is.null,store_id.eq.${storeId}`)
  const filtered = (candidateQuestions ?? []).filter((q) => {
    if (q.formula_item_id) return formulaIds.has(q.formula_item_id)
    if (q.shop_training_item_id) return trainingIds.has(q.shop_training_item_id)
    return false // a Level-Up Exam only tests phase-assigned items — unlike Master, no cross-topic freebies
  })
  if (!filtered.length) return { questions: [], reason: 'no_questions' }

  const questionCount = phaseRows?.level_up_exam_question_count ?? 10
  const tagged = filtered.map((q) => ({
    ...q,
    localId: q.id,
    type: q.question_type === 'multi' ? 'multi' : q.question_type === 'fill_blank' ? 'fill_blank' : 'choice',
  }))
  const questions = shuffle(tagged).slice(0, questionCount)
  return { questions, reason: null }
}

// Expert Exam question set — shared by the real Expert Exam (initial +
// title-defense re-sit, both self-graded) AND, later, any Mock Expert mode.
// Unlike Master (which draws from EVERY active/visible item), Jeff's spec
// for Expert is narrower: "出題是從phase 1-6勾選的item出題" — only items
// that have been assigned into phase 1-6 (must-know items assigned via the
// normal 1-5 dropdown, PLUS whichever non-must-know items were checked into
// phase 6 via the dedicated Add Item picker) are eligible. "邏輯設定都跟
// master exam一樣" — same settings/grading logic as Master, so this reuses
// master_quiz_settings (question_count/error_tolerance) and the same
// isMustKnow-miss-always-fails rule; it's a sibling of buildMasterExamQuestionSet
// with a narrower item pool, not a new settings row.
export async function buildExpertExamQuestionSet(storeId) {
  const [{ data: formulaItemRows }, { data: drinkStoreRows }, { data: trainingItemRows }, { data: settings }] = await Promise.all([
    supabase.from('formula_items').select('id, is_must_know, training_journey_phase, must_appear_in_exam').eq('is_active', true),
    supabase.from('formula_item_stores').select('*'),
    storeId
      ? supabase.from('shop_training_items').select('id, is_must_know, training_journey_phase, must_appear_in_exam').eq('store_id', storeId)
      : Promise.resolve({ data: [] }),
    supabase.from('master_quiz_settings').select('*').maybeSingle(),
  ])
  const visibleFormulaItems = filterVisibleForStore(formulaItemRows ?? [], drinkStoreRows ?? [], 'formula_item_id', storeId)
  const phaseSixFormulaItems = visibleFormulaItems.filter((i) => i.training_journey_phase && i.training_journey_phase <= 6)
  const mustKnowFormulaIds = new Set(phaseSixFormulaItems.filter((i) => i.is_must_know).map((i) => i.id))
  const visibleFormulaIdSet = new Set(phaseSixFormulaItems.map((i) => i.id))
  const phaseSixTrainingItems = (trainingItemRows ?? []).filter((i) => i.training_journey_phase && i.training_journey_phase <= 6)
  const mustKnowTrainingIds = new Set(phaseSixTrainingItems.filter((i) => i.is_must_know).map((i) => i.id))
  const trainingIdSet = new Set(phaseSixTrainingItems.map((i) => i.id))
  const mustAppearFormulaIds = new Set(phaseSixFormulaItems.filter((i) => i.must_appear_in_exam).map((i) => i.id))
  const mustAppearTrainingIds = new Set(phaseSixTrainingItems.filter((i) => i.must_appear_in_exam).map((i) => i.id))

  const questionCount = settings?.question_count ?? 30
  const errorTolerance = settings?.error_tolerance ?? 0

  if (!visibleFormulaIdSet.size && !trainingIdSet.size) return { questions: [], reason: 'no_questions', errorTolerance }

  const { data: candidateQuestions } = await supabase.from('quiz_questions').select('*').or(`store_id.is.null,store_id.eq.${storeId}`)
  const filtered = (candidateQuestions ?? []).filter((q) => {
    if (q.formula_item_id) return visibleFormulaIdSet.has(q.formula_item_id)
    if (q.shop_training_item_id) return trainingIdSet.has(q.shop_training_item_id)
    return true
  })
  if (!filtered.length) return { questions: [], reason: 'no_questions', errorTolerance }

  const tagged = filtered.map((q) => ({
    ...q,
    localId: q.id,
    type: q.question_type === 'multi' ? 'multi' : q.question_type === 'fill_blank' ? 'fill_blank' : 'choice',
    isMustKnow: q.formula_item_id ? mustKnowFormulaIds.has(q.formula_item_id) : q.shop_training_item_id ? mustKnowTrainingIds.has(q.shop_training_item_id) : false,
  }))
  const { forced, rest } = splitForced(shuffle(tagged), mustAppearFormulaIds, mustAppearTrainingIds)
  const questions = combineWithForced(forced, rest, questionCount)
  return { questions, reason: null, errorTolerance }
}
