import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { buildLevelUpExamQuestionSet } from '../../../lib/examBuilders'
import { gradeQuestion } from '../../../lib/quizGrading'

// A Phase 1-5 Level-Up Exam — self-graded, every question must be correct
// to pass (Jeff: "要全部都答對才能通過這個phase"). Drawn from must-know items
// across every phase up to and including `phaseNumber`. On pass, bumps
// profiles.training_journey_phase and tells the parent (TrainingJourneyPage)
// to show the "🎉 Congratulations, Level-Up Unlocked!" celebration — passing
// phase 5 specifically is what starts showing the Formal Exam next.
export default function LevelUpExamModal({ phaseNumber, phaseLabel, onClose, onPassed }) {
  const { profile, currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [reason, setReason] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    buildLevelUpExamQuestionSet(currentStoreId, phaseNumber).then((res) => {
      setQuestions(res.questions)
      setReason(res.reason)
      setLoading(false)
    })
  }, [currentStoreId, phaseNumber])

  async function submit() {
    setSubmitting(true)
    let correct = 0
    const answerRows = questions.map((q) => {
      const { isCorrect, row } = gradeQuestion(q, answers)
      if (isCorrect) correct += 1
      return row
    })
    const total = questions.length
    const passed = correct === total

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .insert({
        profile_id: profile.id,
        store_id: currentStoreId,
        quiz_type: 'level_up',
        phase_number: phaseNumber,
        total_questions: total,
        correct_count: correct,
        passed,
        passed_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (attempt) {
      const { error } = await supabase.from('quiz_attempt_answers').insert(answerRows.map((r) => ({ ...r, attempt_id: attempt.id })))
      if (error) console.error('Failed to save quiz answer detail:', error)
    }
    if (passed) {
      await supabase.from('profiles').update({ training_journey_phase: phaseNumber }).eq('id', profile.id)
    }
    setResult({ correct, total, passed })
    setSubmitting(false)
  }

  function finish() {
    if (result?.passed) onPassed()
    else onClose()
  }

  return (
    <Modal open onClose={onClose} wide title={`Level-Up Exam — Phase ${phaseNumber}: ${phaseLabel}`}>
      {loading ? (
        <LoadingSpinner />
      ) : result ? (
        <div className="py-6 text-center">
          <p className="text-3xl font-bold text-brand-600">
            {result.correct} out of {result.total}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {result.passed
              ? 'Every question correct — you leveled up!'
              : 'Every question needs to be correct to level up — give it another go once you review.'}
          </p>
          <Button className="mt-4" onClick={finish}>
            {result.passed ? 'Continue' : 'Close'}
          </Button>
        </div>
      ) : !questions.length ? (
        <EmptyState label={reason === 'no_questions' ? 'No Level-Up Exam questions set up yet for this phase.' : 'Nothing to quiz on yet.'} />
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
            {submitting ? 'Submitting…' : 'Submit Exam'}
          </Button>
        </div>
      )}
    </Modal>
  )
}
