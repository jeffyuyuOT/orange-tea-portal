import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { filterVisibleForStore } from '../../../lib/storeVisibility'
import { weightedSample } from '../../../lib/quizSelection'
import { buildQuantityChoiceQuestion } from '../../../lib/formulaChoiceQuestion'
import { buildFormalExamQuestionSet, buildMasterExamQuestionSet } from '../../../lib/examBuilders'
import { gradeQuestion } from '../../../lib/quizGrading'

// Jeff, 2026-10-02 (Training Journey spec, point 1): Quick Quiz and Formal
// Quiz used to be two separate buttons/modals (QuickQuizModal.jsx,
// FormalQuizModal.jsx) — merged into one "Take a Quiz" picker with THREE
// modes. The real, title-affecting Formal Exam and Master Exam now live on
// the Training Journey tab instead (gated by phase progress, see
// LevelUpExamModal.jsx / FormalExamModal.jsx / MasterExamModal.jsx) — this
// picker only ever starts Quick Quiz (unchanged) or a MOCK run of the other
// two question-building algorithms (buildFormalExamQuestionSet /
// buildMasterExamQuestionSet, shared with the real exams via
// src/lib/examBuilders.js), purely for practice. Mock attempts ARE saved to
// Quiz History (so staff/managers can review them later) but never touch
// profiles.qualified / training_journey_phase / has_master_title — see the
// quiz_type branch in submit() below.
const MODES = [
  { key: 'quick', label: '🧠 Quick Quiz', hint: 'From whatever you\'ve ticked "Memorized" so far.' },
  { key: 'mock_formal', label: '📝 Mock Formal Quiz', hint: "Practice run of the real Formal Exam's question set — doesn't affect your title." },
  { key: 'mock_master', label: '🏆 Mock Expert/Master Exam', hint: "Practice run of the real Master Exam's question set — doesn't affect your title." },
]

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

// --- Quick Quiz question building (unchanged from the old
// QuickQuizModal.jsx — Quick Quiz isn't shared with any real exam, so it
// stays local here rather than moving to examBuilders.js). ------------------

async function buildFormulaFillBlankQuestions(memorizedIds, targetCount, top10Ids = new Set(), top10Weight = 1) {
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
  const sizedItemIds = new Set((sizedItemRows ?? []).map((r) => r.formula_item_id))
  const candidates = (rows ?? []).filter(
    (r) => !excludedIds.has(r.ingredient_id) && !(sizedItemIds.has(r.formula_item_id) && !r.size_id) && !r.is_hot
  )
  if (!candidates.length) return []

  const byIngredient = {}
  ;(allRows ?? []).forEach((r) => {
    ;(byIngredient[r.ingredient_id] ??= new Set()).add(r.quantity_text)
  })

  return weightedSample(candidates, (c) => (top10Ids.has(c.formula_item_id) ? top10Weight : 1), targetCount)
    .map((row) => {
      const sizeSuffix = row.drink_sizes?.name ? ` (${row.drink_sizes.name})` : ''
      const sugarSuffix = (row.ingredient_master?.name ?? '').trim().toLowerCase() === 'sugar' ? ' (Full Sugar)' : ''
      const groupSuffix = row.group_label ? ` (${row.group_label})` : ''
      const built = buildQuantityChoiceQuestion({
        questionText: `How much ${row.ingredient_master?.name ?? 'this ingredient'}${groupSuffix} goes in ${itemLabel(row.formula_items)}${sizeSuffix}${sugarSuffix}?`,
        quantityText: row.quantity_text,
        realPool: [...(byIngredient[row.ingredient_id] ?? [])],
      })
      if (!built) return null
      return { id: `formula-${row.id}`, isGenerated: true, ...built }
    })
    .filter(Boolean)
}

async function buildBankChoiceQuestions(memorizedIds, storeId, targetCount, ratio) {
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

async function buildQuickQuizSet(profile, storeId) {
  let memorizedIds
  if (profile.qualified) {
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

  const { data: drinkStoreRows } = await supabase.from('formula_item_stores').select('*').in('formula_item_id', memorizedIds)
  memorizedIds = filterVisibleForStore(memorizedIds.map((id) => ({ id })), drinkStoreRows ?? [], 'formula_item_id', storeId).map(
    (i) => i.id
  )
  if (!memorizedIds.length) return { questions: [], reason: 'no_questions' }

  const { data: settings } = await supabase.from('quiz_settings').select('*').maybeSingle()
  const questionCount = settings?.question_count ?? 10
  const ratio = settings?.importance_ratio ?? { 1: 50, 2: 30, 3: 20 }
  const formulaRatio = settings?.formula_question_ratio ?? 0

  let top10Ids = new Set()
  let top10Weight = 1
  let mustKnowIds = new Set()
  const formulaTarget = Math.round((questionCount * formulaRatio) / 100)
  if (formulaTarget > 0) {
    const [{ data: formalSettings }, { data: itemFlagRows }] = await Promise.all([
      supabase.from('formal_quiz_settings').select('top10_fill_blank_weight').maybeSingle(),
      supabase.from('formula_items').select('id, top_10, is_must_know').in('id', memorizedIds),
    ])
    top10Weight = formalSettings?.top10_fill_blank_weight ?? 3
    top10Ids = new Set((itemFlagRows ?? []).filter((r) => r.top_10).map((r) => r.id))
    mustKnowIds = new Set((itemFlagRows ?? []).filter((r) => r.is_must_know).map((r) => r.id))
  }
  const mustKnowMemorizedIds = memorizedIds.filter((id) => mustKnowIds.has(id))
  const formulaQuestions =
    formulaTarget > 0 ? await buildFormulaFillBlankQuestions(mustKnowMemorizedIds, formulaTarget, top10Ids, top10Weight) : []

  const bankTarget = questionCount - formulaQuestions.length
  const bankQuestions = bankTarget > 0 ? await buildBankChoiceQuestions(memorizedIds, storeId, bankTarget, ratio) : []

  const questions = shuffle([...formulaQuestions, ...bankQuestions]).map((q) => ({
    ...q,
    type: q.question_type === 'multi' ? 'multi' : q.question_type === 'fill_blank' ? 'fill_blank' : 'choice',
    localId: q.id,
  }))
  if (!questions.length) return { questions: [], reason: 'no_questions' }
  return { questions, reason: null }
}

// Jeff, 2026-10-03: "原本新員工進度每20%考試的機制取消，因為現在有phase
// level up exam" — this used to also open in a `forced` mode (crossed
// another 20% of Must Know Item progress without quizzing since — the old
// QuickQuizModal.jsx's always-on behavior), skipping straight to Quick Quiz
// and non-dismissable. That's gone along with the check that used to
// trigger it (StudyLogPage.jsx) — this modal now always opens on its mode
// picker and can always be dismissed.
export default function TakeAQuizModal({ onClose, onCompleted }) {
  const { profile, currentStoreId } = useAuth()
  const [mode, setMode] = useState(null)
  const [loading, setLoading] = useState(false)
  const [questions, setQuestions] = useState([])
  const [reason, setReason] = useState(null)
  const [errorTolerance, setErrorTolerance] = useState(0)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!mode) return
    setLoading(true)
    setAnswers({})
    setResult(null)
    const builder =
      mode === 'quick'
        ? buildQuickQuizSet(profile, currentStoreId)
        : mode === 'mock_formal'
          ? buildFormalExamQuestionSet(profile.id, currentStoreId)
          : buildMasterExamQuestionSet(currentStoreId)
    builder.then((res) => {
      setQuestions(res.questions)
      setReason(res.reason)
      setErrorTolerance(res.errorTolerance ?? 0)
      setLoading(false)
    })
  }, [mode, profile, currentStoreId])

  function finish() {
    if (onCompleted) onCompleted()
    else onClose()
  }

  async function submit() {
    setSubmitting(true)
    let correct = 0
    let wrongMustKnow = 0
    let wrongOther = 0
    const answerRows = questions.map((q) => {
      const { isCorrect, row } = gradeQuestion(q, answers)
      if (isCorrect) correct += 1
      else if (mode === 'mock_master' && q.isMustKnow) wrongMustKnow += 1
      else if (mode === 'mock_master') wrongOther += 1
      return row
    })

    // Self-graded pass verdict for the two mock modes, shown for practice
    // feedback only — never written anywhere that affects real title state.
    // Mock Formal: every question is must-know-sourced (see
    // buildFormalExamQuestionSet), so passing means a perfect score, same as
    // a real Level-Up/Formal Exam. Mock Master: any missed must-know
    // question fails outright; otherwise up to `errorTolerance` other
    // misses are OK.
    const total = questions.length
    const mockPassed = mode === 'mock_formal' ? correct === total : mode === 'mock_master' ? wrongMustKnow === 0 && wrongOther <= errorTolerance : null

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .insert({
        profile_id: profile.id,
        store_id: currentStoreId,
        quiz_type: mode,
        total_questions: total,
        correct_count: correct,
        ...(mode !== 'quick' ? { passed: !!mockPassed, passed_at: new Date().toISOString() } : {}),
      })
      .select()
      .single()
    if (attempt) {
      const { error } = await supabase.from('quiz_attempt_answers').insert(answerRows.map((r) => ({ ...r, attempt_id: attempt.id })))
      if (error) console.error('Failed to save quiz answer detail:', error)
    }
    setResult({ correct, total, mockPassed })
    setSubmitting(false)
  }

  const title = mode === 'quick' ? 'Quick Quiz' : mode === 'mock_formal' ? 'Mock Formal Quiz' : mode === 'mock_master' ? 'Mock Expert/Master Exam' : 'Take a Quiz'

  return (
    <Modal open onClose={onClose} wide title={title}>
      {!mode ? (
        <div className="space-y-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className="block w-full rounded-lg border border-brand-200 px-4 py-3 text-left hover:bg-brand-50"
            >
              <p className="text-sm font-medium text-gray-800">{m.label}</p>
              <p className="text-xs text-gray-500">{m.hint}</p>
            </button>
          ))}
        </div>
      ) : (
        <>
          {loading ? (
            <LoadingSpinner />
          ) : result ? (
            <div className="py-6 text-center">
              <p className="text-3xl font-bold text-brand-600">
                {result.correct} out of {result.total}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                correct answers
                {result.mockPassed !== null && (
                  <>
                    {' '}— {result.mockPassed ? '✅ would pass' : '❌ would not pass'} the real exam.{' '}
                    This is practice only and doesn't affect your title.
                  </>
                )}
              </p>
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
                    : 'No quiz questions available yet.'
                }
              />
              <div className="text-center">
                <Button variant="secondary" onClick={() => setMode(null)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {questions.map((q, idx) => {
                const qType = q.type ?? 'choice'
                const key = q.localId ?? q.id
                return (
                  <div key={key}>
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
                        value={answers[key] ?? ''}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                      />
                    ) : (
                      <div className="space-y-1.5">
                        {(q.choices ?? []).map((c) => {
                          const checked = qType === 'multi' ? (answers[key] ?? []).includes(c.key) : answers[key] === c.key
                          return (
                            <label
                              key={c.key}
                              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                                checked ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
                              }`}
                            >
                              <input
                                type={qType === 'multi' ? 'checkbox' : 'radio'}
                                name={qType === 'multi' ? undefined : key}
                                checked={checked}
                                onChange={(e) =>
                                  setAnswers((prev) => {
                                    if (qType !== 'multi') return { ...prev, [key]: c.key }
                                    const current = prev[key] ?? []
                                    return { ...prev, [key]: e.target.checked ? [...current, c.key] : current.filter((k) => k !== c.key) }
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
        </>
      )}
    </Modal>
  )
}
