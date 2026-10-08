import { supabase } from './supabaseClient'
import { filterVisibleForStore } from './storeVisibility'
import { weightedSampleOnePerGroup } from './quizSelection'
import { buildHardQuantityChoiceQuestion, isNumericQuantity } from './formulaChoiceQuestion'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Jeff, 2026-10-07: "Must Appear in Exam的選項從商品編輯移除，重要的題目標註
// important 1就好" — the per-item "guarantee this a slot" forcing mechanism
// (migration 0093's must_appear_in_exam, and the splitForced/
// combineWithForced helpers that used to live here) is retired; an
// important question is simply tagged importance = 1 on the question itself
// (Admin Center / shop Quiz Bank question editor), which Formal Exam's own
// importance-ratio sampling below already weights toward (50% of its slots
// by default — see `ratio`/`byImportance`). Master Exam and Level-Up Exam
// never had an importance-ratio concept of their own, so they're back to a
// plain shuffle+slice over their full eligible pool, same as before
// migration 0093 added the forcing layer.

// Jeff, 2026-10-07 (8-point phase-merge request, point 4): title-defense
// attempts (Formal/Master) draw their question count from the shared
// title_defense_settings table instead of that exam's own voluntary
// question_count, so the defense's own budget is separate from however many
// questions someone chooses to put in the regular Formal/Master Exam
// settings.
//
// Jeff, 2026-10-07 (later): "title defense exam增加Error tolerance
// (non-must-know misses allowed)選項" — title_defense_settings also got its
// own error_tolerance column (migration 0097), used by BOTH a Formal
// (Advanced) and a Master title-defense attempt instead of each exam's own
// voluntary-attempt tolerance (Formal's voluntary attempt still needs a
// perfect score; Master's voluntary attempt still uses its own
// master_quiz_settings.error_tolerance) — same "any missed must-know-linked
// question always fails regardless" rule underneath.
async function titleDefenseSettings() {
  const { data } = await supabase.from('title_defense_settings').select('question_count, error_tolerance').maybeSingle()
  return { questionCount: data?.question_count ?? 20, errorTolerance: data?.error_tolerance ?? 0 }
}

// Jeff, 2026-10-07 (8-point phase-merge request, point 6): "Formula
// fill-in-the-blank questions套用在所有exam (including level-up/formal/
// master/title defend exam)" — this generated-fill-blank-candidate pool
// (turns a recorded formula quantity into a typed-answer question) used to
// be built only inside buildFormalExamQuestionSet; it's now a shared helper
// so Level-Up and Master Exam can mix the same kind of question in too,
// each scoped to its own `eligibleFormulaIds` (bounding candidates to
// whatever item pool that exam type already allows) and optionally
// requiring must-know (Level-Up's pool is must-know-only by construction;
// Master's deliberately isn't, per Jeff: "Master exam會從所有item出題
// (不限定must-know item)"). Confirmed with Jeff: every exam type shares the
// same global fill_in_blank_ratio/top10_fill_blank_weight settings
// (formal_quiz_settings) — no new per-exam-type settings row.
async function buildGeneratedFillBlankCandidates(eligibleFormulaIds, { requireMustKnow } = {}) {
  if (!eligibleFormulaIds?.length) return { candidates: [], realQuantityPool: {} }
  const [{ data: itemFlagRows }, { data: ingredientRows }, { data: excludedRows }, { data: allQuantityRows }, { data: sizedItemRows }] = await Promise.all([
    supabase.from('formula_items').select('id, top_10').in('id', eligibleFormulaIds),
    supabase
      .from('formula_item_ingredients')
      .select(
        'id, ingredient_id, quantity_text, is_hot, size_id, group_label, ingredient_master(name), formula_items!inner(id, name_en, name_zh, is_must_know), drink_sizes(name)'
      )
      .in('formula_item_id', eligibleFormulaIds)
      .not('ingredient_id', 'is', null),
    supabase.from('quiz_excluded_ingredients').select('ingredient_id'),
    supabase
      .from('formula_item_ingredients')
      .select('ingredient_id, quantity_text')
      .not('quantity_text', 'is', null)
      .not('ingredient_id', 'is', null)
      .neq('quantity_text', ''),
    supabase.from('formula_item_sizes').select('formula_item_id').in('formula_item_id', eligibleFormulaIds),
  ])
  const top10Ids = new Set((itemFlagRows ?? []).filter((r) => r.top_10).map((r) => r.id))
  const excludedIngredientIds = new Set((excludedRows ?? []).map((r) => r.ingredient_id))
  const sizedItemIds = new Set((sizedItemRows ?? []).map((r) => r.formula_item_id))
  const candidates = (ingredientRows ?? [])
    .filter(
      (r) =>
        r.quantity_text?.trim() &&
        r.ingredient_master?.name &&
        !r.is_hot &&
        !excludedIngredientIds.has(r.ingredient_id) &&
        (!requireMustKnow || r.formula_items?.is_must_know) &&
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
  return { candidates, realQuantityPool }
}

// Shared fill-in-the-blank selection math: weighted-samples up to
// `fillBlankTarget` from the combined generated + bank candidate pool (⭐
// Top 10 drinks weighted higher, same `top10Weight` for every exam type),
// then converts each selected generated candidate into a hard multiple-
// choice question wherever enough real-quantity distractors exist for that
// ingredient (bank fill-blanks — an admin's own hand-written question —
// always stay typed-answer, regardless of `forceMultipleChoice`).
//
// Jeff, 2026-10-07: "Quick Quiz's version of these questions is always
// multiple choice...改成all quizzes' version (except formal quiz) of these
// questions is always multiple choice" — Formal Quiz (voluntary or its
// Advanced title-defense re-sit) is the one exception that keeps a ⭐ Top 10
// drink's generated question typed (`forceMultipleChoice` left false/
// omitted there, the original behavior); every other quiz type (Quick,
// Level-Up, Master, and a Master title-defense re-sit) passes
// `forceMultipleChoice: true` so even a Top 10 drink's generated question
// gets converted — no typed-answer generated question anywhere outside
// Formal Quiz.
//
// Jeff, 2026-10-08: "formula某ingredient裡是文字敘述的就不考(或者是有辦法弄成
// 類似選擇題)，像是fresh milk and herbal jelly的herbal jelly是half cup" — a
// recorded quantity that isn't a number at all (not just an unusual unit)
// has no reliable typed-answer check: an auto-generated candidate has no
// admin-curated accepted-answers list the way a hand-written Quiz Bank
// question does, so "half cup" would otherwise demand that exact phrase.
// buildHardQuantityChoiceQuestion already tries to turn it into multiple
// choice instead (other real recorded amounts for the same ingredient as
// the wrong answers — see its own comment); when even that isn't possible
// (no other real amount on record for this ingredient at all), the
// question is dropped from the exam entirely instead of falling back to an
// unreliable typed answer — same rule applies to the Top-10-stays-typed
// branch below, since "most rigorous, typed" only makes sense for an actual
// number to type.
function selectFillBlankQuestions({
  candidates,
  fillBlankTarget,
  top10Weight,
  realQuantityPool,
  forceMultipleChoice = false,
  excludeDrinkIds,
}) {
  if (!candidates.length || fillBlankTarget <= 0) return []
  const weightOf = (c) => (c.topTen ? top10Weight : 1)
  // Jeff, 2026-10-08: "不要抓到同樣的飲料，除非可以抓的飲料比題數少" — group by
  // drink (a candidate with no linked drink at all, e.g. a bank fill-blank
  // question with no formula item, is never grouped with anything else —
  // `|| c.localId` keeps it its own singleton group) so two fill-blank
  // questions about the same drink only both get asked once every other
  // eligible drink already has one.
  const groupOf = (c) => c.formulaItemId || `solo-${c.localId}`
  const selected = weightedSampleOnePerGroup(candidates, weightOf, groupOf, Math.min(fillBlankTarget, candidates.length), excludeDrinkIds)
  return selected
    .map((q) => {
      if (!q.isGenerated) return q
      if (!forceMultipleChoice && q.topTen) return isNumericQuantity(q.quantityText) ? q : null
      const built = buildHardQuantityChoiceQuestion({
        questionText: q.question,
        quantityText: q.quantityText,
        realPool: [...(realQuantityPool[q.ingredientId] ?? [])],
      })
      return built ? { ...q, type: 'choice', isGenerated: true, choices: built.choices, correct_choice: built.correct_choice } : null
    })
    .filter(Boolean)
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
// item, must-know or not. `isDefense` (point 4): a title-defense attempt
// draws its question count from title_defense_settings instead of this
// exam's own voluntary question_count — and, since 2026-10-07 (error-
// tolerance addition), also grades with title_defense_settings.
// error_tolerance instead of needing a perfect score: every question here is
// already must-know-linked-or-unlinked (see the comment above), so a defense
// attempt tags each question `isMustKnow` (true when linked to an item —
// every linked item here is must-know by construction — false for an
// unlinked cross-drink concept question) and the caller fails outright on
// any missed must-know question, same "non-must-know misses allowed" rule
// Master Exam already uses, up to `errorTolerance` other misses. A
// voluntary (non-defense) attempt is unaffected — it's graded by manager
// review / auto-pass-if-already-qualified, never by this tolerance.
export async function buildFormalExamQuestionSet(profileId, storeId, { isDefense } = {}) {
  const { data: memorized } = await supabase.from('study_progress').select('formula_item_id').eq('profile_id', profileId).eq('memorized', true)
  let memorizedIds = (memorized ?? []).map((m) => m.formula_item_id)
  if (!memorizedIds.length) return { questions: [], reason: 'no_memorized' }

  const { data: drinkStoreRows } = await supabase.from('formula_item_stores').select('*').in('formula_item_id', memorizedIds)
  memorizedIds = filterVisibleForStore(memorizedIds.map((id) => ({ id })), drinkStoreRows ?? [], 'formula_item_id', storeId).map((i) => i.id)
  if (!memorizedIds.length) return { questions: [], reason: 'no_questions' }

  const { data: settings } = await supabase.from('formal_quiz_settings').select('*').maybeSingle()
  const defenseSettings = isDefense ? await titleDefenseSettings() : null
  const questionCount = defenseSettings ? defenseSettings.questionCount : settings?.question_count ?? 30
  const errorTolerance = defenseSettings?.errorTolerance ?? 0
  const ratio = settings?.importance_ratio ?? { 1: 50, 2: 30, 3: 20 }
  const fillBlankRatio = settings?.fill_in_blank_ratio ?? 20
  const top10Weight = settings?.top10_fill_blank_weight ?? 3

  const { data: itemFlagRows } = await supabase
    .from('formula_items')
    .select('id, top_10, is_must_know')
    .in('id', memorizedIds)
  const mustKnowIds = new Set((itemFlagRows ?? []).filter((r) => r.is_must_know).map((r) => r.id))
  const mustKnowMemorizedIds = memorizedIds.filter((id) => mustKnowIds.has(id))

  const [{ candidates: fillBlankCandidates, realQuantityPool }, { data: candidateQuestions }] = await Promise.all([
    buildGeneratedFillBlankCandidates(memorizedIds, { requireMustKnow: true }),
    supabase
      .from('quiz_questions')
      .select('*')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .or(`formula_item_id.is.null,formula_item_id.in.(${mustKnowMemorizedIds.join(',') || 'null'})`),
  ])

  let mcVisible = []
  let bankFillBlankVisible = []
  if (candidateQuestions?.length) {
    const top10Ids = new Set((itemFlagRows ?? []).filter((r) => r.top_10).map((r) => r.id))
    mcVisible = candidateQuestions
      .filter((q) => (q.question_type ?? 'single') !== 'fill_blank')
      .map((q) => ({ type: q.question_type === 'multi' ? 'multi' : 'choice', localId: q.id, isMustKnow: !!q.formula_item_id, ...q }))
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
        isMustKnow: !!q.formula_item_id,
      }))
  }
  // Every generated candidate here came from buildGeneratedFillBlankCandidates
  // with requireMustKnow: true — always must-know-linked by construction.
  const taggedFillBlankCandidates = fillBlankCandidates.map((c) => ({ ...c, isMustKnow: true }))

  const allFillBlankCandidates = [...taggedFillBlankCandidates, ...bankFillBlankVisible]
  if (!allFillBlankCandidates.length && !mcVisible.length) return { questions: [], reason: 'no_questions', errorTolerance }

  let fillBlankTarget = Math.round((questionCount * fillBlankRatio) / 100)
  fillBlankTarget = Math.min(fillBlankTarget, allFillBlankCandidates.length)
  let mcTarget = questionCount - fillBlankTarget

  let fillBlankSelected = selectFillBlankQuestions({ candidates: allFillBlankCandidates, fillBlankTarget, top10Weight, realQuantityPool })

  const fillBlankDrinkIds = new Set(fillBlankSelected.map((c) => c.formulaItemId).filter(Boolean))
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
  let mcSelected = mcPicked.slice(0, mcTarget)

  const shortfall = questionCount - mcSelected.length - fillBlankSelected.length
  if (shortfall > 0) {
    const usedIds = new Set(fillBlankSelected.map((f) => f.localId))
    // excludeDrinkIds: fillBlankDrinkIds — this shortfall top-up is a SECOND
    // selectFillBlankQuestions call for the same attempt, so without this it
    // could land back on a drink the first call already used while another
    // eligible drink was still sitting unused.
    const extra = selectFillBlankQuestions({
      candidates: allFillBlankCandidates.filter((f) => !usedIds.has(f.localId)),
      fillBlankTarget: shortfall,
      top10Weight,
      realQuantityPool,
      excludeDrinkIds: fillBlankDrinkIds,
    })
    fillBlankSelected = [...fillBlankSelected, ...extra]
  }

  const combined = shuffle([...mcSelected, ...fillBlankSelected]).slice(0, questionCount)
  return { questions: combined, reason: null, errorTolerance }
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
// `isDefense` (point 4): draws its question count from
// title_defense_settings instead of master_quiz_settings.question_count —
// and, since 2026-10-07, its error_tolerance too, instead of
// master_quiz_settings' own (that one now only governs a voluntary Master
// Exam attempt).
export async function buildMasterExamQuestionSet(storeId, { isDefense } = {}) {
  const [{ data: formulaItemRows }, { data: drinkStoreRows }, { data: trainingItemRows }, { data: settings }, { data: formalSettings }] = await Promise.all([
    supabase.from('formula_items').select('id, is_must_know').eq('is_active', true),
    supabase.from('formula_item_stores').select('*'),
    storeId
      ? supabase.from('shop_training_items').select('id, is_must_know').eq('store_id', storeId)
      : Promise.resolve({ data: [] }),
    supabase.from('master_quiz_settings').select('*').maybeSingle(),
    supabase.from('formal_quiz_settings').select('fill_in_blank_ratio, top10_fill_blank_weight').maybeSingle(),
  ])
  const visibleFormulaItems = filterVisibleForStore(formulaItemRows ?? [], drinkStoreRows ?? [], 'formula_item_id', storeId)
  const mustKnowFormulaIds = new Set(visibleFormulaItems.filter((i) => i.is_must_know).map((i) => i.id))
  const visibleFormulaIdSet = new Set(visibleFormulaItems.map((i) => i.id))
  const mustKnowTrainingIds = new Set((trainingItemRows ?? []).filter((i) => i.is_must_know).map((i) => i.id))
  const trainingIdSet = new Set((trainingItemRows ?? []).map((i) => i.id))

  const defenseSettings = isDefense ? await titleDefenseSettings() : null
  const questionCount = defenseSettings ? defenseSettings.questionCount : settings?.question_count ?? 30
  const errorTolerance = defenseSettings ? defenseSettings.errorTolerance : settings?.error_tolerance ?? 0
  const fillBlankRatio = formalSettings?.fill_in_blank_ratio ?? 20
  const top10Weight = formalSettings?.top10_fill_blank_weight ?? 3

  const [{ candidates: fillBlankCandidates, realQuantityPool }, { data: candidateQuestions }] = await Promise.all([
    buildGeneratedFillBlankCandidates([...visibleFormulaIdSet], { requireMustKnow: false }),
    supabase.from('quiz_questions').select('*').or(`store_id.is.null,store_id.eq.${storeId}`),
  ])

  const filtered = (candidateQuestions ?? []).filter((q) => {
    if (q.formula_item_id) return visibleFormulaIdSet.has(q.formula_item_id)
    if (q.shop_training_item_id) return trainingIdSet.has(q.shop_training_item_id)
    return true
  })
  if (!filtered.length && !fillBlankCandidates.length) return { questions: [], reason: 'no_questions', errorTolerance }

  function tag(q) {
    return {
      ...q,
      localId: q.id,
      type: q.question_type === 'multi' ? 'multi' : q.question_type === 'fill_blank' ? 'fill_blank' : 'choice',
      isMustKnow: q.formula_item_id ? mustKnowFormulaIds.has(q.formula_item_id) : q.shop_training_item_id ? mustKnowTrainingIds.has(q.shop_training_item_id) : false,
      // Jeff, 2026-10-08: selectFillBlankQuestions groups fill-blank
      // candidates by `formulaItemId` (camelCase) to dedupe-by-drink — a
      // bank-sourced fill-blank question only carries the DB's snake_case
      // `formula_item_id` until tagged here, so without this it would fall
      // through to its own `solo-${localId}` group and never be recognized
      // as "the same drink" as a generated candidate for that drink.
      formulaItemId: q.formula_item_id,
    }
  }
  const mcPool = filtered.filter((q) => q.question_type !== 'fill_blank').map(tag)
  const bankFillBlankVisible = filtered.filter((q) => q.question_type === 'fill_blank').map(tag)
  const allFillBlankCandidates = [...fillBlankCandidates, ...bankFillBlankVisible]

  let fillBlankTarget = Math.round((questionCount * fillBlankRatio) / 100)
  fillBlankTarget = Math.min(fillBlankTarget, allFillBlankCandidates.length)
  const fillBlankSelected = selectFillBlankQuestions({
    candidates: allFillBlankCandidates,
    fillBlankTarget,
    top10Weight,
    realQuantityPool,
    forceMultipleChoice: true, // Master Exam isn't Formal Quiz — no typed-answer generated questions, even for a ⭐ Top 10 drink
  }).map((q) => (q.isMustKnow === undefined ? { ...q, isMustKnow: q.formulaItemId ? mustKnowFormulaIds.has(q.formulaItemId) : false } : q))

  const fillBlankDrinkIds = new Set(fillBlankSelected.map((c) => c.formulaItemId).filter(Boolean))
  const mcTarget = questionCount - fillBlankSelected.length
  const mcSelected = shuffle(mcPool.filter((q) => !fillBlankDrinkIds.has(q.formula_item_id))).slice(0, mcTarget)

  const questions = shuffle([...mcSelected, ...fillBlankSelected]).slice(0, questionCount)
  return { questions, reason: null, errorTolerance }
}

// Level-Up Exam question set (phases 1-3) — must-know items across every
// phase UP TO AND INCLUDING the one being tested (Jeff: "level up exam會從
// 之前所有phase的內容出考題"). Plain multiple-choice/multi bank questions
// pooled the same way Master Exam's are (no importance-ratio concept),
// plus generated fill-in-the-blank questions (point 6) from the same
// item pool — every candidate here is must-know by construction since only
// must-know items are ever assigned to a phase — each graded needing a
// perfect score to pass.
export async function buildLevelUpExamQuestionSet(storeId, upToPhase) {
  const [{ data: formulaItemRows }, { data: drinkStoreRows }, { data: trainingItemRows }, { data: phaseRows }, { data: formalSettings }] = await Promise.all([
    supabase.from('formula_items').select('id, training_journey_phase').eq('is_active', true).eq('is_must_know', true),
    supabase.from('formula_item_stores').select('*'),
    storeId
      ? supabase.from('shop_training_items').select('id, training_journey_phase').eq('store_id', storeId).eq('is_must_know', true)
      : Promise.resolve({ data: [] }),
    supabase.from('training_journey_phases').select('phase_number, level_up_exam_question_count').eq('phase_number', upToPhase).maybeSingle(),
    supabase.from('formal_quiz_settings').select('fill_in_blank_ratio, top10_fill_blank_weight').maybeSingle(),
  ])
  const visibleFormulaItems = filterVisibleForStore(formulaItemRows ?? [], drinkStoreRows ?? [], 'formula_item_id', storeId)
  const formulaIds = new Set(visibleFormulaItems.filter((i) => i.training_journey_phase && i.training_journey_phase <= upToPhase).map((i) => i.id))
  const trainingIds = new Set(
    (trainingItemRows ?? []).filter((i) => i.training_journey_phase && i.training_journey_phase <= upToPhase).map((i) => i.id)
  )
  if (!formulaIds.size && !trainingIds.size) return { questions: [], reason: 'no_questions' }

  const fillBlankRatio = formalSettings?.fill_in_blank_ratio ?? 20
  const top10Weight = formalSettings?.top10_fill_blank_weight ?? 3

  const [{ candidates: fillBlankCandidates, realQuantityPool }, { data: candidateQuestions }] = await Promise.all([
    buildGeneratedFillBlankCandidates([...formulaIds], { requireMustKnow: true }),
    supabase.from('quiz_questions').select('*').or(`store_id.is.null,store_id.eq.${storeId}`),
  ])
  const filtered = (candidateQuestions ?? []).filter((q) => {
    if (q.formula_item_id) return formulaIds.has(q.formula_item_id)
    if (q.shop_training_item_id) return trainingIds.has(q.shop_training_item_id)
    return false // a Level-Up Exam only tests phase-assigned items — unlike Master, no cross-topic freebies
  })
  if (!filtered.length && !fillBlankCandidates.length) return { questions: [], reason: 'no_questions' }

  const questionCount = phaseRows?.level_up_exam_question_count ?? 10

  // formulaItemId (camelCase): same reasoning as Master Exam's tag() above —
  // needed so a bank fill-blank question groups by drink correctly in
  // selectFillBlankQuestions' dedupe-by-drink logic.
  function tag(q) {
    return {
      ...q,
      localId: q.id,
      type: q.question_type === 'multi' ? 'multi' : q.question_type === 'fill_blank' ? 'fill_blank' : 'choice',
      formulaItemId: q.formula_item_id,
    }
  }
  const mcPool = filtered.filter((q) => q.question_type !== 'fill_blank').map(tag)
  const bankFillBlankVisible = filtered.filter((q) => q.question_type === 'fill_blank').map(tag)
  const allFillBlankCandidates = [...fillBlankCandidates, ...bankFillBlankVisible]

  let fillBlankTarget = Math.round((questionCount * fillBlankRatio) / 100)
  fillBlankTarget = Math.min(fillBlankTarget, allFillBlankCandidates.length)
  const fillBlankSelected = selectFillBlankQuestions({
    candidates: allFillBlankCandidates,
    fillBlankTarget,
    top10Weight,
    realQuantityPool,
    forceMultipleChoice: true, // Level-Up Exam isn't Formal Quiz — no typed-answer generated questions, even for a ⭐ Top 10 drink
  })

  const fillBlankDrinkIds = new Set(fillBlankSelected.map((c) => c.formulaItemId).filter(Boolean))
  const mcTarget = questionCount - fillBlankSelected.length
  const mcSelected = shuffle(mcPool.filter((q) => !fillBlankDrinkIds.has(q.formula_item_id))).slice(0, mcTarget)

  const questions = shuffle([...mcSelected, ...fillBlankSelected]).slice(0, questionCount)
  return { questions, reason: null }
}
