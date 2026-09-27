import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { isAnswerAccepted } from '../../../lib/answerMatching'
import { filterVisibleForStore } from '../../../lib/storeVisibility'
import { weightedSample } from '../../../lib/quizSelection'
import { buildQuantityChoiceQuestion } from '../../../lib/formulaChoiceQuestion'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Formal Quiz mixes question sources: curated Single/Multi choice and
// Fill-in-the-blank questions from the Quiz Bank (same pool Quick Quiz
// draws from), plus fill-in-the-blank questions generated on the fly from
// Formula Database recipes (formula_item_ingredients) — no separate
// authoring needed for those. Both kinds of fill-blank question are pooled
// together below and graded the same lenient way — see
// src/lib/answerMatching.js.
async function buildFormalQuizSet(profileId, storeId) {
  const { data: memorized } = await supabase
    .from('study_progress')
    .select('formula_item_id')
    .eq('profile_id', profileId)
    .eq('memorized', true)
  let memorizedIds = (memorized ?? []).map((m) => m.formula_item_id)
  if (!memorizedIds.length) return { questions: [], reason: 'no_memorized' }

  // A drink this store doesn't carry (per Formula Database's own per-item
  // store list, formula_item_stores) is dropped before anything else below
  // — this takes priority over a quiz question's own separate store
  // restriction (quiz_question_stores, checked further down) and applies to
  // BOTH the auto-generated ingredient-based fill-blank questions and the
  // Quiz Bank questions pulled below, since both are drawn from
  // memorizedIds: the Formula Database's per-drink store assignment is
  // authoritative.
  const { data: drinkStoreRows } = await supabase
    .from('formula_item_stores')
    .select('*')
    .in('formula_item_id', memorizedIds)
  memorizedIds = filterVisibleForStore(
    memorizedIds.map((id) => ({ id })),
    drinkStoreRows ?? [],
    'formula_item_id',
    storeId
  ).map((i) => i.id)
  if (!memorizedIds.length) return { questions: [], reason: 'no_questions' }

  const { data: settings } = await supabase.from('formal_quiz_settings').select('*').eq('store_id', storeId).maybeSingle()
  const questionCount = settings?.question_count ?? 30
  const ratio = settings?.importance_ratio ?? { 1: 50, 2: 30, 3: 20 }
  const fillBlankRatio = settings?.fill_in_blank_ratio ?? 20
  // How many times more likely a fill-blank candidate linked to a ⭐ Top 10
  // drink is to be picked below, versus any other memorized item (1 = no
  // boost). See FormalQuizSettingsTab.jsx + migration 0046.
  const top10Weight = settings?.top10_fill_blank_weight ?? 3
  // What % of the auto-generated "how much of this ingredient" questions
  // (not the curated Quiz Bank fill-blank ones — see the comment where this
  // is used below) get shown as multiple choice instead of typed. Default 0
  // = today's all-typed behavior. See migration 0050 / Quiz Bank > Setting.
  const mcFillBlankPct = settings?.mc_fill_blank_pct ?? 0

  // Which of the memorized items are ⭐ Top 10 — used to weight both kinds
  // of fill-blank candidate below (the auto-generated ones and any Quiz
  // Bank fill-blank question linked to a formula item).
  const { data: top10Rows } = await supabase.from('formula_items').select('id, top_10').in('id', memorizedIds)
  const top10Ids = new Set((top10Rows ?? []).filter((r) => r.top_10).map((r) => r.id))

  // --- Fill-in-the-blank candidates: one per ingredient line that has both
  // an ingredient name and a typed quantity (a custom-image-only line with
  // no ingredient_id can't be turned into a text question). Excludes the
  // Hot-serving variant (see QuickQuizModal.jsx's buildFormulaQuestions for
  // the same exclusion + rationale) — only an item's normal ingredient rows
  // become questions here. ---
  const [{ data: ingredientRows }, { data: excludedRows }, { data: allQuantityRows }] = await Promise.all([
    supabase
      .from('formula_item_ingredients')
      .select('id, ingredient_id, quantity_text, is_hot, ingredient_master(name), formula_items!inner(id, name_en, name_zh)')
      .in('formula_item_id', memorizedIds)
      .not('ingredient_id', 'is', null),
    // Same admin-curated exclusion list Quick Quiz's buildFormulaQuestions
    // already used (e.g. water, ice — quantity isn't meaningful to quiz on)
    // — shared across both quiz types, see the "Formula fill-in-the-blank
    // questions" settings section in QuizBankPage.jsx. Formal Quiz didn't
    // apply this before, so an excluded ingredient could still turn up here.
    supabase.from('quiz_excluded_ingredients').select('ingredient_id'),
    // Every distinct quantity_text recorded anywhere (any item, any store)
    // for each ingredient — only fetched/used when mcFillBlankPct > 0 below,
    // to supply "real" wrong answers when converting one of these to
    // multiple choice, same source Quick Quiz's buildFormulaQuestions uses.
    mcFillBlankPct > 0
      ? supabase
          .from('formula_item_ingredients')
          .select('ingredient_id, quantity_text')
          .not('quantity_text', 'is', null)
          .not('ingredient_id', 'is', null)
          .neq('quantity_text', '')
      : Promise.resolve({ data: [] }),
  ])
  const excludedIngredientIds = new Set((excludedRows ?? []).map((r) => r.ingredient_id))
  const fillBlankCandidates = (ingredientRows ?? [])
    .filter((r) => r.quantity_text?.trim() && r.ingredient_master?.name && !r.is_hot && !excludedIngredientIds.has(r.ingredient_id))
    .map((r) => ({
      type: 'fill_blank',
      isGenerated: true,
      localId: r.id,
      ingredientId: r.ingredient_id,
      quantityText: r.quantity_text.trim(),
      question: `${r.formula_items.name_en}${r.formula_items.name_zh ? ` · ${r.formula_items.name_zh}` : ''} — how much ${r.ingredient_master.name}?`,
      correctAnswer: r.quantity_text.trim(),
      topTen: top10Ids.has(r.formula_items.id),
      formulaItemId: r.formula_items.id,
    }))
  const realQuantityPool = {}
  ;(allQuantityRows ?? []).forEach((r) => {
    ;(realQuantityPool[r.ingredient_id] ??= new Set()).add(r.quantity_text)
  })

  // --- Choice-type candidates (single or multi) + bank-authored fill-blank
  // candidates: same source/filtering as Quick Quiz, split by question_type.
  // A question authored as 'single' renders/grades as the original 'choice'
  // type; 'multi' and 'fill_blank' are new. ---
  const { data: candidateQuestions } = await supabase.from('quiz_questions').select('*').in('formula_item_id', memorizedIds)
  let mcVisible = []
  let bankFillBlankVisible = []
  if (candidateQuestions?.length) {
    const ids = candidateQuestions.map((q) => q.id)
    const { data: restrictionRows } = await supabase.from('quiz_question_stores').select('*').in('question_id', ids)
    const restrictedIds = new Set((restrictionRows ?? []).map((r) => r.question_id))
    const allowedPairs = new Set((restrictionRows ?? []).map((r) => `${r.question_id}:${r.store_id}`))
    const visible = candidateQuestions.filter((q) => !restrictedIds.has(q.id) || allowedPairs.has(`${q.id}:${storeId}`))
    mcVisible = visible
      .filter((q) => (q.question_type ?? 'single') !== 'fill_blank')
      .map((q) => ({ type: q.question_type === 'multi' ? 'multi' : 'choice', localId: q.id, ...q }))
    bankFillBlankVisible = visible
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
      }))
  }

  // Bank-authored fill-blank questions are pooled together with the
  // auto-generated "ingredient quantity" ones — both graded the same way.
  const allFillBlankCandidates = [...fillBlankCandidates, ...bankFillBlankVisible]

  if (!allFillBlankCandidates.length && !mcVisible.length) return { questions: [], reason: 'no_questions' }

  let fillBlankTarget = Math.round((questionCount * fillBlankRatio) / 100)
  fillBlankTarget = Math.min(fillBlankTarget, allFillBlankCandidates.length)
  let mcTarget = questionCount - fillBlankTarget

  // Fill-blank questions are picked FIRST (not after MC, like before) so we
  // know up front which drinks they already cover. Picked with
  // weightedSample (not a plain shuffle) so ⭐ Top 10-linked candidates come
  // up top10Weight times as often as everything else.
  const fillBlankWeight = (c) => (c.topTen ? top10Weight : 1)
  let fillBlankSelected = weightedSample(allFillBlankCandidates, fillBlankWeight, fillBlankTarget)

  // A drink that already has a fill-in-the-blank question in this quiz
  // (whether auto-generated from its recipe, or a Quiz Bank fill-blank
  // question linked to it) is dropped from the multiple-choice pool below —
  // Jeff asked that the same drink never gets quizzed twice, once via a
  // fill-in-the-blank question and again via an unrelated Quiz Bank
  // question about it.
  const fillBlankDrinkIds = new Set(fillBlankSelected.map((c) => c.formulaItemId).filter(Boolean))
  const mcPool = mcVisible.filter((q) => !fillBlankDrinkIds.has(q.formula_item_id))

  const byImportance = { 1: [], 2: [], 3: [] }
  mcPool.forEach((q) => byImportance[q.importance]?.push(q))
  let mcSelected = []
  for (const level of [1, 2, 3]) {
    const target = Math.round((mcTarget * (ratio[level] ?? 0)) / 100)
    mcSelected.push(...shuffle(byImportance[level]).slice(0, target))
  }
  if (mcSelected.length < mcTarget) {
    const remaining = shuffle(mcPool.filter((q) => !mcSelected.includes(q))).slice(0, mcTarget - mcSelected.length)
    mcSelected.push(...remaining)
  }
  mcSelected = mcSelected.slice(0, mcTarget)

  // If there weren't enough MC questions to fill mcTarget (which is more
  // likely now that mcPool is narrower than mcVisible), top the quiz up
  // with more fill-blank candidates instead (and vice versa isn't needed —
  // fillBlankTarget was already capped to what's available above).
  const shortfall = questionCount - mcSelected.length - fillBlankSelected.length
  if (shortfall > 0) {
    const usedIds = new Set(fillBlankSelected.map((f) => f.localId))
    const extra = weightedSample(allFillBlankCandidates.filter((f) => !usedIds.has(f.localId)), fillBlankWeight, shortfall)
    fillBlankSelected = [...fillBlankSelected, ...extra]
  }

  // Jeff asked why these auto-generated formula questions aren't multiple
  // choice like Quick Quiz's version of the same question — this setting
  // (mc_fill_blank_pct, migration 0050) lets Formal Quiz mix in some. Only
  // the auto-generated ones (isGenerated) are eligible: a curated Quiz Bank
  // fill-blank question is free-form admin-authored text, not necessarily
  // even a quantity, so there's no reliable pool of wrong answers to build
  // choices from — those always stay typed. A candidate that can't get 3
  // distractors (buildQuantityChoiceQuestion returns null — too rare/unique
  // a quantity, nothing to scale) silently stays typed too, rather than
  // erroring or shrinking the quiz.
  if (mcFillBlankPct > 0) {
    const eligible = fillBlankSelected.filter((q) => q.isGenerated)
    const convertCount = Math.round((eligible.length * mcFillBlankPct) / 100)
    const toConvert = new Set(shuffle(eligible).slice(0, convertCount).map((q) => q.localId))
    fillBlankSelected = fillBlankSelected.map((q) => {
      if (!toConvert.has(q.localId)) return q
      const built = buildQuantityChoiceQuestion({
        questionText: q.question,
        quantityText: q.quantityText,
        realPool: [...(realQuantityPool[q.ingredientId] ?? [])],
      })
      return built ? { ...q, type: 'choice', isGenerated: true, choices: built.choices, correct_choice: built.correct_choice } : q
    })
  }

  const combined = shuffle([...mcSelected, ...fillBlankSelected]).slice(0, questionCount)
  return { questions: combined, reason: null }
}

export default function FormalQuizModal({ onClose }) {
  const { profile, currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [reason, setReason] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    buildFormalQuizSet(profile.id, currentStoreId).then(({ questions, reason }) => {
      setQuestions(questions)
      setReason(reason)
      setLoading(false)
    })
  }, [profile.id, currentStoreId])

  async function submit() {
    setSubmitting(true)
    // Already-Qualified staff (profiles.qualified — migration 0049) skip
    // manager review: their Formal Quiz attempts are marked passed at
    // submit time automatically. Fetched fresh here rather than trusting
    // AuthContext's cached `profile`, since a manager could have just
    // granted or cancelled it moments ago (e.g. this attempt was opened
    // from the Bulletin Board's Quiz reminder cadence nudge, possibly a
    // while after the qualified flag last changed). `passed_by` is left
    // null for an auto-pass — there's no manual reviewer to record.
    const { data: freshProfile } = await supabase.from('profiles').select('qualified').eq('id', profile.id).single()
    const autoPassed = !!freshProfile?.qualified
    let correct = 0
    // Every branch returns the same full set of keys (see the matching
    // comment in QuickQuizModal.jsx's submit()) so a future NOT NULL column
    // can never silently fail the whole bulk insert just because one
    // question type's row happens to omit a key another type's row sets —
    // PostgREST fills a row's missing key with NULL, not the column
    // default, when any other row in the same batch has that key.
    const BLANK_ANSWER_ROW = {
      question_id: null,
      question_type: 'choice',
      selected_choice: null,
      selected_choices: null,
      question_text: null,
      correct_answer_text: null,
      answer_text: null,
      is_correct: false,
      is_generated: false,
      generated_question: null,
      generated_choices: null,
      generated_correct_choice: null,
    }
    const answerRows = questions.map((q) => {
      if (q.type === 'choice') {
        const isCorrect = answers[q.localId] === q.correct_choice
        if (isCorrect) correct += 1
        // A curated Quiz Bank single-choice question references its
        // quiz_questions row (question_id); a formula question converted to
        // multiple choice above (q.isGenerated) has no such row, so it
        // carries its own question/choices snapshot instead — same
        // generated_* shape QuickQuizModal.jsx already uses for its
        // formula questions, so Quiz History renders it the same way.
        return q.isGenerated
          ? {
              ...BLANK_ANSWER_ROW,
              question_id: null,
              question_type: 'choice',
              selected_choice: answers[q.localId] ?? null,
              is_correct: isCorrect,
              is_generated: true,
              generated_question: q.question,
              generated_choices: q.choices,
              generated_correct_choice: q.correct_choice,
            }
          : { ...BLANK_ANSWER_ROW, question_id: q.id, question_type: 'choice', selected_choice: answers[q.localId] ?? null, is_correct: isCorrect }
      }
      if (q.type === 'multi') {
        const selected = answers[q.localId] ?? []
        const correctSet = new Set(q.correct_choices ?? [])
        const selectedSet = new Set(selected)
        const isCorrect = correctSet.size === selectedSet.size && [...correctSet].every((c) => selectedSet.has(c))
        if (isCorrect) correct += 1
        return { ...BLANK_ANSWER_ROW, question_id: q.id, question_type: 'multi', selected_choices: selected, is_correct: isCorrect }
      }
      const typed = answers[q.localId] ?? ''
      const isCorrect = isAnswerAccepted(typed, q.correctAnswer, q.acceptedAnswers)
      if (isCorrect) correct += 1
      return {
        ...BLANK_ANSWER_ROW,
        question_id: q.id ?? null,
        question_type: 'fill_blank',
        question_text: q.question,
        correct_answer_text: q.correctAnswer,
        answer_text: typed,
        is_correct: isCorrect,
      }
    })
    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .insert({
        profile_id: profile.id,
        store_id: currentStoreId,
        quiz_type: 'formal',
        total_questions: questions.length,
        correct_count: correct,
        ...(autoPassed ? { passed: true, passed_at: new Date().toISOString() } : {}),
      })
      .select()
      .single()
    if (attempt) {
      const { error } = await supabase.from('quiz_attempt_answers').insert(answerRows.map((r) => ({ ...r, attempt_id: attempt.id })))
      // See the same check in QuickQuizModal.jsx's submit() — this insert
      // used to fail silently and leave Quiz History showing a score with
      // no question detail underneath, with nothing in the UI explaining
      // why. At least log it now so a repeat isn't invisible.
      if (error) console.error('Failed to save quiz answer detail:', error)
    }
    setResult({ correct, total: questions.length, autoPassed })
    setSubmitting(false)
  }

  return (
    <Modal open onClose={onClose} wide title="Formal Quiz">
      {loading ? (
        <LoadingSpinner />
      ) : result ? (
        <div className="py-6 text-center">
          <p className="text-3xl font-bold text-brand-600">
            {result.correct} out of {result.total}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            correct answers —{' '}
            {result.autoPassed
              ? "you're already Qualified, so this attempt didn't need manager review."
              : 'a manager or admin will review this attempt in Learning Tracker.'}
          </p>
          <Button className="mt-4" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : !questions.length ? (
        <EmptyState
          label={
            reason === 'no_memorized'
              ? 'Mark some items as "Memorized" in Study Log first.'
              : 'No quiz questions available yet for your memorized items.'
          }
        />
      ) : (
        <div className="space-y-5">
          {questions.map((q, idx) => (
            <div key={q.localId}>
              {/* whitespace-pre-wrap: see the same fix in QuickQuizModal.jsx
                  — a Quiz Bank question is often authored as multiple lines
                  (the question, then each spaced-out "a. Sugar   b. Taro
                  chunk" choice line), which plain text rendering otherwise
                  collapses into one run-on line. */}
              <p className="mb-2 whitespace-pre-wrap text-sm font-medium text-gray-800">
                {idx + 1}. {q.question}
              </p>
              {q.image_path && (
                <img
                  src={supabase.storage.from('documents').getPublicUrl(q.image_path).data.publicUrl}
                  alt=""
                  className="mb-2 max-h-48 rounded-lg border border-gray-200 object-contain"
                />
              )}
              {q.type === 'choice' || q.type === 'multi' ? (
                <div className="space-y-1.5">
                  {(q.choices ?? []).map((c) => {
                    const isMulti = q.type === 'multi'
                    const checked = isMulti ? (answers[q.localId] ?? []).includes(c.key) : answers[q.localId] === c.key
                    return (
                      <label
                        key={c.key}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                          checked ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
                        }`}
                      >
                        <input
                          type={isMulti ? 'checkbox' : 'radio'}
                          name={q.localId}
                          checked={checked}
                          onChange={() => {
                            if (isMulti) {
                              setAnswers((prev) => {
                                const current = prev[q.localId] ?? []
                                const next = current.includes(c.key)
                                  ? current.filter((k) => k !== c.key)
                                  : [...current, c.key]
                                return { ...prev, [q.localId]: next }
                              })
                            } else {
                              setAnswers((prev) => ({ ...prev, [q.localId]: c.key }))
                            }
                          }}
                        />
                        {c.text}
                      </label>
                    )
                  })}
                </div>
              ) : (
                <input
                  type="text"
                  className="input"
                  placeholder="Type your answer…"
                  value={answers[q.localId] ?? ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.localId]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? 'Submitting…' : 'Submit Quiz'}
          </Button>
        </div>
      )}
    </Modal>
  )
}
