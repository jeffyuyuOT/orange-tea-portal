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

async function buildQuizSet(profileId, storeId) {
  const { data: memorized } = await supabase
    .from('study_progress')
    .select('formula_item_id')
    .eq('profile_id', profileId)
    .eq('memorized', true)
  const memorizedIds = (memorized ?? []).map((m) => m.formula_item_id)
  if (!memorizedIds.length) return { questions: [], reason: 'no_memorized' }

  const { data: settings } = await supabase.from('quiz_settings').select('*').eq('store_id', storeId).maybeSingle()
  const questionCount = settings?.question_count ?? 10
  const ratio = settings?.importance_ratio ?? { 1: 50, 2: 30, 3: 20 }

  const { data: candidateQuestions } = await supabase
    .from('quiz_questions')
    .select('*')
    .in('formula_item_id', memorizedIds)
  if (!candidateQuestions?.length) return { questions: [], reason: 'no_questions' }

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
    const target = Math.round((questionCount * (ratio[level] ?? 0)) / 100)
    selected.push(...shuffle(byImportance[level]).slice(0, target))
  }
  if (selected.length < questionCount) {
    const remaining = shuffle(visible.filter((q) => !selected.includes(q))).slice(0, questionCount - selected.length)
    selected.push(...remaining)
  }
  return { questions: shuffle(selected).slice(0, questionCount), reason: null }
}

export default function QuickQuizModal({ onClose }) {
  const { profile, currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [reason, setReason] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    buildQuizSet(profile.id, currentStoreId).then(({ questions, reason }) => {
      setQuestions(questions)
      setReason(reason)
      setLoading(false)
    })
  }, [profile.id, currentStoreId])

  async function submit() {
    setSubmitting(true)
    let correct = 0
    const answerRows = questions.map((q) => {
      const isCorrect = answers[q.id] === q.correct_choice
      if (isCorrect) correct += 1
      return { question_id: q.id, selected_choice: answers[q.id] ?? null, is_correct: isCorrect }
    })
    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .insert({ profile_id: profile.id, store_id: currentStoreId, total_questions: questions.length, correct_count: correct })
      .select()
      .single()
    if (attempt) {
      await supabase.from('quiz_attempt_answers').insert(answerRows.map((r) => ({ ...r, attempt_id: attempt.id })))
    }
    setResult({ correct, total: questions.length })
    setSubmitting(false)
  }

  return (
    <Modal open onClose={onClose} wide title="Quick Quiz">
      {loading ? (
        <LoadingSpinner />
      ) : result ? (
        <div className="py-6 text-center">
          <p className="text-3xl font-bold text-brand-600">
            {result.correct} out of {result.total}
          </p>
          <p className="mt-1 text-sm text-gray-500">correct answers</p>
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
            <div key={q.id}>
              <p className="mb-2 text-sm font-medium text-gray-800">
                {idx + 1}. {q.question}
              </p>
              <div className="space-y-1.5">
                {(q.choices ?? []).map((c) => (
                  <label
                    key={c.key}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                      answers[q.id] === c.key ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === c.key}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: c.key }))}
                    />
                    {c.text}
                  </label>
                ))}
              </div>
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
