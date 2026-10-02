import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { buildFormalExamQuestionSet } from '../../../lib/examBuilders'
import { gradeQuestion } from '../../../lib/quizGrading'
import { recordFormalDefenseResult } from '../../../lib/trainingJourney'

// The real Formal Exam — reached phase 5 (Advanced title, not yet
// Qualified) or Jeff: "Qualified之後的員工可以進到phase6". Two modes:
//  - isDefense=false (initial): same as the old FormalQuizModal.jsx — a
//    manager/admin reviews the attempt in Learning Tracker and ticks Pass
//    (which is what actually grants Qualified), UNLESS this profile is
//    already qualified (re-attempting voluntarily before a defense is due),
//    in which case it still auto-passes with no reviewer needed.
//  - isDefense=true (the recurring 3-month title-defense re-sit, only
//    reachable once title_defense_due_at has passed): self-graded, every
//    question must be correct — see recordFormalDefenseResult, which also
//    applies the 3-strike disqualify rule.
export default function FormalExamModal({ isDefense = false, onClose, onResult }) {
  const { profile, currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [reason, setReason] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    buildFormalExamQuestionSet(profile.id, currentStoreId).then((res) => {
      setQuestions(res.questions)
      setReason(res.reason)
      setLoading(false)
    })
  }, [profile.id, currentStoreId])

  async function submit() {
    setSubmitting(true)
    let correct = 0
    const answerRows = questions.map((q) => {
      const { isCorrect, row } = gradeQuestion(q, answers)
      if (isCorrect) correct += 1
      return row
    })
    const total = questions.length

    let passed = false
    let disqualified = false
    let message = ''

    if (isDefense) {
      passed = correct === total
      const outcome = await recordFormalDefenseResult(profile.id, passed)
      disqualified = outcome.disqualified
      message = passed
        ? "Defense passed — you keep your Advanced title, and the clock resets for another 3 months."
        : disqualified
          ? "That was your third attempt without a perfect score — you've lost your Advanced title and are back to Proficient. You'll need to pass the Formal Exam again, reviewed by a manager."
          : `Every question needs to be correct to defend your title — ${outcome.attemptsUsed} of 3 attempts used this cycle.`
    } else {
      const { data: freshProfile } = await supabase.from('profiles').select('qualified').eq('id', profile.id).single()
      const autoPassed = !!freshProfile?.qualified
      passed = autoPassed
      message = autoPassed
        ? "you're already Qualified, so this attempt didn't need manager review."
        : 'a manager or admin will review this attempt in Learning Tracker.'
    }

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .insert({
        profile_id: profile.id,
        store_id: currentStoreId,
        quiz_type: 'formal',
        total_questions: total,
        correct_count: correct,
        ...(isDefense || passed ? { passed, passed_at: new Date().toISOString() } : {}),
      })
      .select()
      .single()
    if (attempt) {
      const { error } = await supabase.from('quiz_attempt_answers').insert(answerRows.map((r) => ({ ...r, attempt_id: attempt.id })))
      if (error) console.error('Failed to save quiz answer detail:', error)
    }
    setResult({ correct, total, passed, disqualified, message })
    setSubmitting(false)
  }

  function finish() {
    onResult?.({ passed: result?.passed, disqualified: result?.disqualified })
    onClose()
  }

  return (
    <Modal open onClose={onClose} wide title={isDefense ? 'Formal Exam — Title Defense' : 'Formal Exam'}>
      {loading ? (
        <LoadingSpinner />
      ) : result ? (
        <div className="py-6 text-center">
          <p className="text-3xl font-bold text-brand-600">
            {result.correct} out of {result.total}
          </p>
          <p className="mt-1 text-sm text-gray-500">correct answers — {result.message}</p>
          <Button className="mt-4" onClick={finish}>
            Done
          </Button>
        </div>
      ) : !questions.length ? (
        <EmptyState
          label={reason === 'no_memorized' ? 'Mark some items as "Memorized" in Study Log first.' : 'No quiz questions available yet.'}
        />
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
