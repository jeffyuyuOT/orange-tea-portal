import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { isAnswerAccepted } from '../../../lib/answerMatching'
import { filterVisibleForStore } from '../../../lib/storeVisibility'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const CHOICE_KEYS = ['A', 'B', 'C', 'D']

// "30g" -> { value: 30, suffix: "g" }; "2 pumps" -> { value: 2, suffix: " pumps" }.
// Anything that doesn't start with a number (e.g. "a pinch") is unparseable.
function parseQuantity(text) {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec((text ?? '').trim())
  if (!m) return null
  return { value: parseFloat(m[1]), suffix: m[2] }
}

// Falls back to synthesized wrong answers (scaled versions of the real
// quantity) when there aren't enough *other* real quantities on record for
// this ingredient to use as distractors.
function synthesizeDistractors(quantityText, count, exclude) {
  const parsed = parseQuantity(quantityText)
  if (!parsed || !(parsed.value > 0)) return []
  const { value, suffix } = parsed
  const isInt = Number.isInteger(value)
  const round = (n) => (isInt ? Math.max(1, Math.round(n)) : Math.max(0.1, Math.round(n * 10) / 10))
  const seen = new Set(exclude)
  const out = []
  for (const mult of [0.5, 1.5, 2, 0.75, 1.25]) {
    if (out.length >= count) break
    const text = `${round(value * mult)}${suffix}`
    if (!seen.has(text)) {
      seen.add(text)
      out.push(text)
    }
  }
  return out
}

function itemLabel(item) {
  return item?.name_zh ? `${item.name_en} (${item.name_zh})` : item?.name_en ?? 'this item'
}

// Auto-generated "what's the quantity of this ingredient" questions, built
// live from formula_item_ingredients rather than curated in the quiz bank —
// any ingredient with a recorded quantity_text on a memorized item is fair
// game. Wrong answers are, first choice, other real quantities recorded for
// that same ingredient elsewhere (still plausible-looking), and only
// synthesized (scaled up/down) when there isn't enough real variety.
async function buildFormulaQuestions(memorizedIds, targetCount) {
  if (!targetCount || !memorizedIds.length) return []

  const [{ data: rows }, { data: allRows }, { data: excludedRows }, { data: sizedItemRows }] = await Promise.all([
    supabase
      .from('formula_item_ingredients')
      .select(
        'id, formula_item_id, ingredient_id, quantity_text, is_hot, size_id, group_label, ingredient_master(name), formula_items(name_en, name_zh), drink_sizes(name)'
      )
      .in('formula_item_id', memorizedIds)
      .not('quantity_text', 'is', null)
      .not('ingredient_id', 'is', null)
      .neq('quantity_text', ''),
    supabase
      .from('formula_item_ingredients')
      .select('ingredient_id, quantity_text')
      .not('quantity_text', 'is', null)
      .not('ingredient_id', 'is', null)
      .neq('quantity_text', ''),
    supabase.from('quiz_excluded_ingredients').select('ingredient_id'),
    supabase.from('formula_item_sizes').select('formula_item_id').in('formula_item_id', memorizedIds),
  ])
  const excludedIds = new Set((excludedRows ?? []).map((r) => r.ingredient_id))
  // An item that offers sizes (M/L/...) sometimes still carries older
  // size_id = null ingredient rows left over from before sizing was added
  // to it — duplicates of the real per-size rows, not a "same for every
  // size" value. Quizzing on one of those produces a question with no size
  // mentioned even though the item genuinely has more than one, which reads
  // as wrong/ambiguous — so skip null-size rows on any item that has sizes.
  const sizedItemIds = new Set((sizedItemRows ?? []).map((r) => r.formula_item_id))
  const candidates = (rows ?? []).filter(
    (r) => !excludedIds.has(r.ingredient_id) && !(sizedItemIds.has(r.formula_item_id) && !r.size_id)
  )
  if (!candidates.length) return []

  // Every distinct quantity_text seen anywhere for a given ingredient —
  // the pool of "real" wrong answers before falling back to synthesized ones.
  const byIngredient = {}
  ;(allRows ?? []).forEach((r) => {
    ;(byIngredient[r.ingredient_id] ??= new Set()).add(r.quantity_text)
  })

  return shuffle(candidates)
    .slice(0, targetCount)
    .map((row) => {
      const realPool = [...(byIngredient[row.ingredient_id] ?? [])].filter((v) => v !== row.quantity_text)
      const distractors = shuffle(realPool).slice(0, 3)
      if (distractors.length < 3) {
        distractors.push(
          ...synthesizeDistractors(row.quantity_text, 3 - distractors.length, [row.quantity_text, ...distractors])
        )
      }
      if (!distractors.length) return null // no real alternative on record and quantity_text wasn't a parseable number

      const choices = shuffle([row.quantity_text, ...distractors]).map((text, i) => ({ key: CHOICE_KEYS[i], text }))
      const correctKey = choices.find((c) => c.text === row.quantity_text).key
      const sizeSuffix = row.drink_sizes?.name ? ` (${row.drink_sizes.name})` : ''
      const hotSuffix = row.is_hot ? ' (Hot)' : ''
      // The recipe's recorded quantity for the plain "Sugar" ingredient is
      // the full-sugar (100%) amount — customer sugar-level requests are a
      // % of this at order time, not a separately recorded formula value —
      // so the question needs to say that explicitly or "how much sugar"
      // reads as ambiguous about which sugar level it means.
      const sugarSuffix = (row.ingredient_master?.name ?? '').trim().toLowerCase() === 'sugar' ? ' (Full Sugar)' : ''
      // On the Formula page, ingredients sharing a group_label are boxed
      // together (e.g. "Blender") — the same ingredient can appear more
      // than once in one formula under different groups, so the question
      // needs to name the group to say which occurrence it means.
      const groupSuffix = row.group_label ? ` (${row.group_label})` : ''

      return {
        id: `formula-${row.id}`,
        isGenerated: true,
        question: `How much ${row.ingredient_master?.name ?? 'this ingredient'}${groupSuffix} goes in ${itemLabel(row.formula_items)}${sizeSuffix}${hotSuffix}${sugarSuffix}?`,
        choices,
        correct_choice: correctKey,
      }
    })
    .filter(Boolean)
}

async function buildBankQuestions(memorizedIds, storeId, targetCount, ratio) {
  const { data: candidateQuestions } = await supabase
    .from('quiz_questions')
    .select('*')
    .in('formula_item_id', memorizedIds)
  if (!candidateQuestions?.length) return []

  const ids = candidateQuestions.map((q) => q.id)
  const { data: restrictionRows } = await supabase.from('quiz_question_stores').select('*').in('question_id', ids)
  const restrictedIds = new Set((restrictionRows ?? []).map((r) => r.question_id))
  const allowedPairs = new Set((restrictionRows ?? []).map((r) => `${r.question_id}:${r.store_id}`))
  const visible = candidateQuestions.filter(
    (q) => !restrictedIds.has(q.id) || allowedPairs.has(`${q.id}:${storeId}`)
  )

  const byImportance = { 1: [], 2: [], 3: [] }
  visible.forEach((q) => byImportance[q.importance]?.push(q))

  let selected = []
  for (const level of [1, 2, 3]) {
    const target = Math.round((targetCount * (ratio[level] ?? 0)) / 100)
    selected.push(...shuffle(byImportance[level]).slice(0, target))
  }
  if (selected.length < targetCount) {
    const remaining = shuffle(visible.filter((q) => !selected.includes(q))).slice(0, targetCount - selected.length)
    selected.push(...remaining)
  }
  return shuffle(selected).slice(0, targetCount)
}

async function buildQuizSet(profile, storeId) {
  let memorizedIds
  if (profile.is_senior) {
    // Senior staff count every active item as memorized automatically —
    // see StudyLogList's `senior` prop — so quiz on all of them, not just
    // whatever (if anything) their study_progress rows happen to say.
    const { data: allItems } = await supabase.from('formula_items').select('id').eq('is_active', true)
    memorizedIds = (allItems ?? []).map((i) => i.id)
  } else {
    const { data: memorized } = await supabase
      .from('study_progress')
      .select('formula_item_id')
      .eq('profile_id', profile.id)
      .eq('memorized', true)
    memorizedIds = (memorized ?? []).map((m) => m.formula_item_id)
  }
  if (!memorizedIds.length) return { questions: [], reason: 'no_memorized' }

  // A drink this store doesn't carry (per Formula Database's own per-item
  // store list, formula_item_stores) is dropped before anything else below
  // — this takes priority over a quiz question's own separate store
  // restriction (quiz_question_stores, checked further down): the Formula
  // Database's per-drink store assignment is authoritative.
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

  const { data: settings } = await supabase.from('quiz_settings').select('*').eq('store_id', storeId).maybeSingle()
  const questionCount = settings?.question_count ?? 10
  const ratio = settings?.importance_ratio ?? { 1: 50, 2: 30, 3: 20 }
  const formulaRatio = settings?.formula_question_ratio ?? 0

  const formulaTarget = Math.round((questionCount * formulaRatio) / 100)
  const formulaQuestions = formulaTarget > 0 ? await buildFormulaQuestions(memorizedIds, formulaTarget) : []

  const bankTarget = questionCount - formulaQuestions.length
  const bankQuestions = bankTarget > 0 ? await buildBankQuestions(memorizedIds, storeId, bankTarget, ratio) : []

  const questions = shuffle([...formulaQuestions, ...bankQuestions])
  if (!questions.length) return { questions: [], reason: 'no_questions' }
  return { questions, reason: null }
}

// `forced`: opened automatically because the staff member crossed another
// 10% of their study progress without quizzing since — hides the modal's
// own close affordances (see Modal's `dismissable`) so they have to submit
// (or hit the explicit Close button in the empty-state case) rather than
// dismiss it. `progressPercent`: the memorized % that triggered this quiz
// (or just the current % for a voluntary one), stamped onto the attempt so
// the next forced-quiz check knows which 10% band was last cleared.
// `onCompleted`: called instead of `onClose` once the attempt is submitted
// and the person dismisses the result, so the parent can clear its forced
// state and refresh Quiz History.
export default function QuickQuizModal({ onClose, forced = false, progressPercent = null, onCompleted }) {
  const { profile, currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [reason, setReason] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    buildQuizSet(profile, currentStoreId).then(({ questions, reason }) => {
      setQuestions(questions)
      setReason(reason)
      setLoading(false)
    })
  }, [profile, currentStoreId])

  function finish() {
    if (onCompleted) onCompleted()
    else onClose()
  }

  async function submit() {
    setSubmitting(true)
    let correct = 0
    const answerRows = questions.map((q) => {
      // Every auto-generated "formula" question is single-choice (see
      // buildFormulaQuestions) — only a curated Quiz Bank question can be
      // 'multi' or 'fill_blank'.
      const qType = q.question_type ?? 'single'

      if (qType === 'multi') {
        const selected = answers[q.id] ?? []
        const correctSet = new Set(q.correct_choices ?? [])
        const selectedSet = new Set(selected)
        const isCorrect = correctSet.size === selectedSet.size && [...correctSet].every((k) => selectedSet.has(k))
        if (isCorrect) correct += 1
        return { question_id: q.id, question_type: 'multi', selected_choices: selected, is_correct: isCorrect }
      }

      if (qType === 'fill_blank') {
        const typed = answers[q.id] ?? ''
        const isCorrect = isAnswerAccepted(typed, q.answer_text, q.accepted_answers)
        if (isCorrect) correct += 1
        return {
          question_id: q.id,
          question_type: 'fill_blank',
          question_text: q.question,
          correct_answer_text: q.answer_text,
          answer_text: typed,
          is_correct: isCorrect,
        }
      }

      const isCorrect = answers[q.id] === q.correct_choice
      if (isCorrect) correct += 1
      // Generated questions have no quiz_questions row to reference, so they
      // carry their own snapshot (question text + choices) instead, for
      // Quiz History to render later.
      return q.isGenerated
        ? {
            question_id: null,
            question_type: 'choice',
            selected_choice: answers[q.id] ?? null,
            is_correct: isCorrect,
            is_generated: true,
            generated_question: q.question,
            generated_choices: q.choices,
            generated_correct_choice: q.correct_choice,
          }
        : { question_id: q.id, question_type: 'choice', selected_choice: answers[q.id] ?? null, is_correct: isCorrect }
    })
    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .insert({
        profile_id: profile.id,
        store_id: currentStoreId,
        total_questions: questions.length,
        correct_count: correct,
        progress_snapshot: progressPercent,
      })
      .select()
      .single()
    if (attempt) {
      await supabase.from('quiz_attempt_answers').insert(answerRows.map((r) => ({ ...r, attempt_id: attempt.id })))
    }
    setResult({ correct, total: questions.length })
    setSubmitting(false)
  }

  return (
    <Modal open onClose={onClose} dismissable={!forced} wide title={forced ? 'Quick Quiz Required' : 'Quick Quiz'}>
      {forced && !loading && !result && (
        <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You've crossed another 10% of your study progress — finish this quiz to continue.
        </p>
      )}
      {loading ? (
        <LoadingSpinner />
      ) : result ? (
        <div className="py-6 text-center">
          <p className="text-3xl font-bold text-brand-600">
            {result.correct} out of {result.total}
          </p>
          <p className="mt-1 text-sm text-gray-500">correct answers</p>
          <Button className="mt-4" onClick={finish}>
            Done
          </Button>
        </div>
      ) : !questions.length ? (
        <div className="space-y-3">
          <EmptyState
            label={
              reason === 'no_memorized'
                ? 'Mark some items as "Memorized" in Study Log first.'
                : 'No quiz questions available yet for your memorized items.'
            }
          />
          {forced && (
            <div className="text-center">
              <Button variant="secondary" onClick={finish}>
                Close
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {questions.map((q, idx) => {
            const qType = q.question_type ?? 'single'
            return (
              <div key={q.id}>
                <p className="mb-2 text-sm font-medium text-gray-800">
                  {idx + 1}. {q.question}
                </p>
                {q.image_path && (
                  <img
                    src={supabase.storage.from('documents').getPublicUrl(q.image_path).data.publicUrl}
                    alt=""
                    className="mb-2 max-h-48 rounded-lg border border-gray-200 object-contain"
                  />
                )}
                {qType === 'fill_blank' ? (
                  <input
                    type="text"
                    className="input"
                    placeholder="Type your answer…"
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  />
                ) : (
                  <div className="space-y-1.5">
                    {(q.choices ?? []).map((c) => {
                      const checked = qType === 'multi' ? (answers[q.id] ?? []).includes(c.key) : answers[q.id] === c.key
                      return (
                        <label
                          key={c.key}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                            checked ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
                          }`}
                        >
                          <input
                            type={qType === 'multi' ? 'checkbox' : 'radio'}
                            name={qType === 'multi' ? undefined : q.id}
                            checked={checked}
                            onChange={(e) =>
                              setAnswers((prev) => {
                                if (qType !== 'multi') return { ...prev, [q.id]: c.key }
                                const current = prev[q.id] ?? []
                                return {
                                  ...prev,
                                  [q.id]: e.target.checked ? [...current, c.key] : current.filter((k) => k !== c.key),
                                }
                              })
                            }
                          />
                          {c.text}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? 'Submitting…' : 'Submit Quiz'}
          </Button>
        </div>
      )}
    </Modal>
  )
}
