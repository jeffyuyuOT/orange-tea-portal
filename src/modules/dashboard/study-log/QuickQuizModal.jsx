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

function itemLabel(item) {
  return item?.name_zh ? `${item.name_en} (${item.name_zh})` : item?.name_en ?? 'this item'
}

// Auto-generated "what's the quantity of this ingredient" questions, built
// live from formula_item_ingredients rather than curated in the quiz bank —
// any ingredient with a recorded quantity_text on a memorized item is fair
// game. Wrong answers are, first choice, other real quantities recorded for
// that same ingredient elsewhere (still plausible-looking), and only
// synthesized (scaled up/down) when there isn't enough real variety.
// `top10Ids`/`top10Weight`: same ⭐ Top 10 boost Formal Quiz already applied
// to its fill-in-the-blank pool (formal_quiz_settings.top10_fill_blank_weight)
// — now shared across both quiz types, see the "Formula fill-in-the-blank
// questions" settings section in QuizBankPage.jsx. Picking with
// weightedSample (not a plain shuffle) means a Top 10 drink's questions
// come up top10Weight times as often as everything else, without risking
// the same question twice in one quiz.
async function buildFormulaQuestions(memorizedIds, targetCount, top10Ids = new Set(), top10Weight = 1) {
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
  // Jeff: don't quiz on the Hot-serving variant at all (FormulaIngredientsView
  // shows these as a separate "Hot" tab on items that have one) — only the
  // item's normal/default ingredient rows become fill-in-the-blank
  // questions, same convention menuExport.js already uses for "the"
  // ingredient list of an item (`!ing.is_hot`).
  const candidates = (rows ?? []).filter(
    (r) => !excludedIds.has(r.ingredient_id) && !(sizedItemIds.has(r.formula_item_id) && !r.size_id) && !r.is_hot
  )
  if (!candidates.length) return []

  // Every distinct quantity_text seen anywhere for a given ingredient —
  // the pool of "real" wrong answers before falling back to synthesized ones.
  const byIngredient = {}
  ;(allRows ?? []).forEach((r) => {
    ;(byIngredient[r.ingredient_id] ??= new Set()).add(r.quantity_text)
  })

  return weightedSample(candidates, (c) => (top10Ids.has(c.formula_item_id) ? top10Weight : 1), targetCount)
    .map((row) => {
      const sizeSuffix = row.drink_sizes?.name ? ` (${row.drink_sizes.name})` : ''
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

      const built = buildQuantityChoiceQuestion({
        questionText: `How much ${row.ingredient_master?.name ?? 'this ingredient'}${groupSuffix} goes in ${itemLabel(row.formula_items)}${sizeSuffix}${sugarSuffix}?`,
        quantityText: row.quantity_text,
        realPool: [...(byIngredient[row.ingredient_id] ?? [])],
      })
      if (!built) return null // no real alternative on record and quantity_text wasn't a parseable number

      return { id: `formula-${row.id}`, isGenerated: true, ...built }
    })
    .filter(Boolean)
}

// Jeff, 2026-09: "現在出題的時候也會依照各分店的題庫去抓題" — quiz_questions
// is store-owned outright (migration 0071, same shape as shop_training_items
// since 0052) instead of one shared bank with an optional "visible at these
// stores" restriction list, so this filters straight on store_id instead of
// separately fetching quiz_question_stores and computing which rows are
// visible at storeId.
//
// Jeff, 2026-09 (later): "各分店實行quick跟formal quiz出題時就會從admin bank
// 跟分店自己的bank裡一起抓題" — a reinstated admin-authored, shared tier
// (store_id IS NULL — migration 0073) is pooled together with this store's
// own branch questions here, not just the branch ones.
async function buildBankQuestions(memorizedIds, storeId, targetCount, ratio) {
  const { data: candidateQuestions } = await supabase
    .from('quiz_questions')
    .select('*')
    .or(`store_id.is.null,store_id.eq.${storeId}`)
    .in('formula_item_id', memorizedIds)
  if (!candidateQuestions?.length) return []

  const byImportance = { 1: [], 2: [], 3: [] }
  candidateQuestions.forEach((q) => byImportance[q.importance]?.push(q))

  let selected = []
  for (const level of [1, 2, 3]) {
    const target = Math.round((targetCount * (ratio[level] ?? 0)) / 100)
    selected.push(...shuffle(byImportance[level]).slice(0, target))
  }
  if (selected.length < targetCount) {
    const remaining = shuffle(candidateQuestions.filter((q) => !selected.includes(q))).slice(0, targetCount - selected.length)
    selected.push(...remaining)
  }
  return shuffle(selected).slice(0, targetCount)
}

async function buildQuizSet(profile, storeId) {
  let memorizedIds
  if (profile.qualified) {
    // Qualified staff count every active item as memorized automatically —
    // see StudyLogList's `qualified` prop — so quiz on all of them, not just
    // whatever (if anything) their study_progress rows happen to say. (Also
    // covers the never-reachable old "senior" case, which this replaced.)
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
  // — this takes priority over which store owns a given quiz_questions row
  // (checked further down, in buildBankQuestions): the Formula Database's
  // per-drink store assignment is authoritative.
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

  // Jeff, 2026-09-30 (migration 0079_quiz_settings_global.sql): quiz_settings
  // and formal_quiz_settings are now global singletons, one row shared by
  // every store — no more per-store store_id filter here.
  const { data: settings } = await supabase.from('quiz_settings').select('*').maybeSingle()
  const questionCount = settings?.question_count ?? 10
  const ratio = settings?.importance_ratio ?? { 1: 50, 2: 30, 3: 20 }
  const formulaRatio = settings?.formula_question_ratio ?? 0

  // Top 10 weighting for the formula questions below is a setting shared
  // with Formal Quiz — read from the same formal_quiz_settings row so a ⭐
  // Top 10 drink gets boosted consistently in both quiz types, not just one.
  let top10Ids = new Set()
  let top10Weight = 1
  const formulaTarget = Math.round((questionCount * formulaRatio) / 100)
  if (formulaTarget > 0) {
    const [{ data: formalSettings }, { data: top10Rows }] = await Promise.all([
      supabase.from('formal_quiz_settings').select('top10_fill_blank_weight').maybeSingle(),
      supabase.from('formula_items').select('id, top_10').in('id', memorizedIds),
    ])
    top10Weight = formalSettings?.top10_fill_blank_weight ?? 3
    top10Ids = new Set((top10Rows ?? []).filter((r) => r.top_10).map((r) => r.id))
  }
  const formulaQuestions = formulaTarget > 0 ? await buildFormulaQuestions(memorizedIds, formulaTarget, top10Ids, top10Weight) : []

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
    // Every branch below returns the SAME full set of keys, with whichever
    // ones don't apply to that question type set to null explicitly,
    // instead of just omitting them. That's not cosmetic: this whole array
    // goes to Supabase as ONE bulk insert, and PostgREST derives its INSERT
    // column list from the union of keys across every row in the batch —
    // a row that omits a key some OTHER row in the same batch has gets an
    // explicit NULL for it, not the column's database default. `is_generated`
    // is NOT NULL with a default of false but used to only be set on the
    // (rare) auto-generated-question branch — so any quiz that mixed one
    // generated question with any non-generated one silently failed the
    // WHOLE insert (a not-null violation on the other rows' now-NULL
    // is_generated), leaving Quiz History showing a score with zero saved
    // question detail. Keeping every row's shape identical avoids this
    // however the columns change in the future, not just for this column.
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
        return { ...BLANK_ANSWER_ROW, question_id: q.id, question_type: 'multi', selected_choices: selected, is_correct: isCorrect }
      }

      if (qType === 'fill_blank') {
        const typed = answers[q.id] ?? ''
        const isCorrect = isAnswerAccepted(typed, q.answer_text, q.accepted_answers)
        if (isCorrect) correct += 1
        return {
          ...BLANK_ANSWER_ROW,
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
            ...BLANK_ANSWER_ROW,
            question_id: null,
            question_type: 'choice',
            selected_choice: answers[q.id] ?? null,
            is_correct: isCorrect,
            is_generated: true,
            generated_question: q.question,
            generated_choices: q.choices,
            generated_correct_choice: q.correct_choice,
          }
        : { ...BLANK_ANSWER_ROW, question_id: q.id, question_type: 'choice', selected_choice: answers[q.id] ?? null, is_correct: isCorrect }
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
      const { error } = await supabase.from('quiz_attempt_answers').insert(answerRows.map((r) => ({ ...r, attempt_id: attempt.id })))
      // This insert used to fail silently (no error check at all) — a bad
      // row anywhere in the batch fails the whole thing atomically, so one
      // insert going wrong meant Quiz History would forever show a score
      // with zero question detail underneath, no error, nothing in the UI
      // to explain why. Logging it at least makes a repeat of that visible
      // in the browser console instead of just vanishing.
      if (error) console.error('Failed to save quiz answer detail:', error)
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
                {/* whitespace-pre-wrap: a Quiz Bank question is often typed
                    as multiple lines (the question itself, then each
                    "a. Sugar   b. Taro chunk" choice line spaced out for
                    readability in the Quiz Bank editor) — plain text
                    rendering collapses all of that to one run-on line, so
                    this preserves the line breaks/spacing exactly as
                    authored. */}
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
