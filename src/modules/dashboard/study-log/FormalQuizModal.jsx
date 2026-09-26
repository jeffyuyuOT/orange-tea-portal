import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { isAnswerAccepted } from '../../../lib/answerMatching'

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
      }))
  }

  // Bank-authored fill-blank questions are pooled together with the
  // auto-generated "ingredient quantity" ones — both graded the same way.
  const allFillBlankCandidates = [...fillBlankCandidates, ...bankFillBlankVisible]

  if (!allFillBlankCandidates.length && !mcVisible.length) return { questions: [], reason: 'no_questions' }

  let fillBlankTarget = Math.round((questionCount * fillBlankRatio) / 100)
  fillBlankTarget = Math.min(fillBlankTarget, allFillBlankCandidates.length)
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
  let fillBlankSelected = shuffle(allFillBlankCandidates).slice(0, fillBlankTarget)
  const shortfall = questionCount - mcSelected.length - fillBlankSelected.length
  if (shortfall > 0) {
    const usedIds = new Set(fillBlankSelected.map((f) => f.localId))
    const extra = shuffle(allFillBlankCandidates.filter((f) => !usedIds.has(f.localId))).slice(0, shortfall)
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
      if (q.type === 'multi') {
        const selected = answers[q.localId] ?? []
        const correctSet = new Set(q.correct_choices ?? [])
        const selectedSet = new Set(selected)
        const isCorrect = correctSet.size === selectedSet.size && [...correctSet].every((c) => selectedSet.has(c))
        if (isCorrect) correct += 1
        return { question_id: q.id, question_type: 'multi', selected_choices: selected, is_correct: isCorrect }
      }
      const typed = answers[q.localId] ?? ''
      const isCorrect = isAnswerAccepted(typed, q.correctAnswer, q.acceptedAnswers)
      if (isCorrect) correct += 1
      return {
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
