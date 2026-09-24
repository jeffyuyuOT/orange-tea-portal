import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Loose match for fill-in-the-blank answers: quantity_text is free text
// typed by an admin in Formula Database (e.g. "30g", "2 pumps"), so an
// exact-string requirement would fail a correct answer typed with
// different spacing/case ("30 G" vs "30g"). Trim + lowercase + collapse
// whitespace before comparing.
function normalizeAnswer(s) {
  return (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, '')
}

// Formal Quiz mixes two question sources: curated multiple-choice from the
// Quiz Bank (same pool Quick Quiz draws from) plus fill-in-the-blank
// questions generated on the fly from Formula Database recipes
// (formula_item_ingredients) — no separate authoring needed for those.
async function buildFormalQuizSet(profileId, storeId) {
  const { data: memorized } = await supabase
    .from('study_progress')
    .select('formula_item_id')
    .eq('profile_id', profileId)
    .eq('memorized', true)
  const memorizedIds = (memorized ?? []).map((m) => m.formula_item_id)
  if (!memorizedIds.length) return { questions: [], reason: 'no_memorized' }

  const { data: settings } = await supabase.from('formal_quiz_settings').select('*').eq('store_id', storeId).maybeSingle()
  const questionCount = settings?.question_count ?? 30
  const ratio = settings?.importance_ratio ?? { 1: 50, 2: 30, 3: 20 }
  const fillBlankRatio = settings?.fill_in_blank_ratio ?? 20

  // --- Fill-in-the-blank candidates: one per ingredient line that has both
  // an ingredient name and a typed quantity (a custom-image-only line with
  // no ingredient_id can't be turned into a text question). ---
  const { data: ingredientRows } = await supabase
    .from('formula_item_ingredients')
    .select('id, quantity_text, ingredient_master(name), formula_items!inner(id, name_en, name_zh)')
    .in('formula_item_id', memorizedIds)
    .not('ingredient_id', 'is', null)
  const fillBlankCandidates = (ingredientRows ?? [])
    .filter((r) => r.quantity_text?.trim() && r.ingredient_master?.name)
    .map((r) => ({
      type: 'fill_blank',
      localId: r.id,
      question: `${r.formula_items.name_en}${r.formula_items.name_zh ? ` · ${r.formula_items.name_zh}` : ''} — how much ${r.ingredient_master.name}?`,
      correctAnswer: r.quantity_text.trim(),
    }))

  // --- Multiple-choice candidates: same source/filtering as Quick Quiz. ---
  const { data: candidateQuestions } = await supabase.from('quiz_questions').select('*').in('formula_item_id', memorizedIds)
  let mcVisible = []
  if (candidateQuestions?.length) {
    const ids = candidateQuestions.map((q) => q.id)
    const { data: restrictionRows } = await supabase.from('quiz_question_stores').select('*').in('question_id', ids)
    const restrictedIds = new Set((restrictionRows ?? []).map((r) => r.question_id))
    const allowedPairs = new Set((restrictionRows ?? []).map((r) => `${r.question_id}:${r.store_id}`))
    mcVisible = candidateQuestions
      .filter((q) => !restrictedIds.has(q.id) || allowedPairs.has(`${q.id}:${storeId}`))
      .map((q) => ({ type: 'choice', localId: q.id, ...q }))
  }

  if (!fillBlankCandidates.length && !mcVisible.length) return { questions: [], reason: 'no_questions' }

  let fillBlankTarget = Math.round((questionCount * fillBlankRatio) / 100)
  fillBlankTarget = Math.min(fillBlankTarget, fillBlankCandidates.length)
  let mcTarget = questionCount - fillBlankTarget

  const byImportance = { 1: [], 2: [], 3: [] }
  mcVisible.forEach((q) => byImportance[q.importance]?.push(q))
  let mcSelected = []
  for (const level of [1, 2, 3]) {
    const target = Math.round((mcTarget * (ratio[level] ?? 0)) / 100)
    mcSelected.push(...shuffle(byImportance[level]).slice(0, target))
  }
  if (mcSelected.length < mcTarget) {
    const remaining = shuffle(mcVisible.filter((q) => !mcSelected.includes(q))).slice(0, mcTarget - mcSelected.length)
    mcSelected.push(...remaining)
  }
  mcSelected = mcSelected.slice(0, mcTarget)

  // If there weren't enough MC questions to fill mcTarget, top the quiz up
  // with more fill-blank candidates instead (and vice versa isn't needed —
  // fillBlankTarget was already capped to what's available above).
  let fillBlankSelected = shuffle(fillBlankCandidates).slice(0, fillBlankTarget)
  const shortfall = questionCount - mcSelected.length - fillBlankSelected.length
  if (shortfall > 0) {
    const usedIds = new Set(fillBlankSelected.map((f) => f.localId))
    const extra = shuffle(fillBlankCandidates.filter((f) => !usedIds.has(f.localId))).slice(0, shortfall)
    fillBlankSelected = [...fillBlankSelected, ...extra]
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
    let correct = 0
    const answerRows = questions.map((q) => {
      if (q.type === 'choice') {
        const isCorrect = answers[q.localId] === q.correct_choice
        if (isCorrect) correct += 1
        return { question_id: q.id, question_type: 'choice', selected_choice: answers[q.localId] ?? null, is_correct: isCorrect }
      }
      const typed = answers[q.localId] ?? ''
      const isCorrect = !!typed && normalizeAnswer(typed) === normalizeAnswer(q.correctAnswer)
      if (isCorrect) correct += 1
      return {
        question_id: null,
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
    <Modal open onClose={onClose} wide title="Formal Quiz">
      {loading ? (
        <LoadingSpinner />
      ) : result ? (
        <div className="py-6 text-center">
          <p className="text-3xl font-bold text-brand-600">
            {result.correct} out of {result.total}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            correct answers — a manager or admin will review this attempt in Learning Tracker.
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
              <p className="mb-2 text-sm font-medium text-gray-800">
                {idx + 1}. {q.question}
              </p>
              {q.type === 'choice' ? (
                <div className="space-y-1.5">
                  {(q.choices ?? []).map((c) => (
                    <label
                      key={c.key}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                        answers[q.localId] === c.key ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.localId}
                        checked={answers[q.localId] === c.key}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.localId]: c.key }))}
                      />
                      {c.text}
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  type="text"
                  className="input"
                  placeholder="Type the amount…"
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
